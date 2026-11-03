#!/usr/bin/env python3
"""Copy Match Monitor's SQLite tables into an empty PostgreSQL database.

Run with the sportsmatch service stopped. The script reads DATABASE_PATH and
DATABASE_URL from the process environment or /opt/sportsmatch/.env. It always
refuses to copy into a PostgreSQL database that already contains rows.
"""
import argparse
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

TABLES = (
    "tasks",
    "usage",
    "sporttery_match_numbers",
    "basketball_fixture_cache",
    "parlay_tickets",
    "parlay_legs",
)
SERIAL_TABLES = ("tasks", "parlay_tickets", "parlay_legs")


def load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if key:
            os.environ.setdefault(key, value)


def main() -> int:
    parser = argparse.ArgumentParser(description="Safely migrate Match Monitor SQLite data to PostgreSQL.")
    parser.add_argument("--apply", action="store_true", help="copy rows; without this flag the script only checks readiness")
    args = parser.parse_args()

    env_path = Path(os.environ.get("SPORTSMATCH_ENV_FILE", str(ROOT / ".env")))
    load_env_file(env_path)

    source_value = os.environ.get("DATABASE_PATH", str(ROOT / "data" / "matches.sqlite3"))
    source = Path(source_value)
    if not source.is_absolute():
        source = ROOT / source
    source = source.resolve()
    if not source.is_file():
        raise SystemExit(f"SQLite database file not found: {source}")

    if not os.environ.get("DATABASE_URL", "").strip():
        raise SystemExit("DATABASE_URL is missing; set it in /opt/sportsmatch/.env first.")

    import app as monitor

    if not monitor.USE_POSTGRES:
        raise SystemExit("DATABASE_URL must use postgres:// or postgresql://.")
    monitor.init_db()

    with sqlite3.connect(source) as sqlite_db:
        sqlite_db.row_factory = sqlite3.Row
        check = sqlite_db.execute("PRAGMA quick_check").fetchone()[0]
        if check != "ok":
            raise SystemExit(f"SQLite integrity check failed: {check}")
        source_columns = {}
        source_counts = {}
        for table in TABLES:
            cursor = sqlite_db.execute(f'SELECT * FROM "{table}" LIMIT 0')
            source_columns[table] = [column[0] for column in cursor.description]
            source_counts[table] = int(sqlite_db.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])

    target_counts = {}
    with monitor.conn() as pg:
        for table in TABLES:
            row = pg.execute(f'SELECT COUNT(*) AS row_count FROM "{table}"').fetchone()
            target_counts[table] = int(row["row_count"])
            columns = pg.execute(
                """SELECT column_name FROM information_schema.columns
                   WHERE table_schema=current_schema() AND table_name=?
                   ORDER BY ordinal_position""",
                (table,),
            ).fetchall()
            target_columns = {row["column_name"] for row in columns}
            missing = sorted(set(source_columns[table]) - target_columns)
            extra = sorted(target_columns - set(source_columns[table]))
            if missing or extra:
                raise SystemExit(
                    f"Schema mismatch for {table}: missing in PostgreSQL={missing}, extra in PostgreSQL={extra}"
                )

    nonempty = {table: count for table, count in target_counts.items() if count}
    if nonempty:
        raise SystemExit(f"PostgreSQL already contains rows; refusing to overwrite: {nonempty}")

    print("Source SQLite rows:")
    for table in TABLES:
        print(f"  {table}: {source_counts[table]}")
    print("PostgreSQL target is empty and table columns match.")

    if not args.apply:
        print("Readiness check only; no rows were copied. Stop sportsmatch-web.service, then rerun with --apply.")
        return 0

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = source.with_name(f"{source.name}.pre-postgres-{stamp}")
    with sqlite3.connect(source) as source_db, sqlite3.connect(backup) as backup_db:
        source_db.backup(backup_db)
    os.chmod(backup, 0o600)
    print(f"SQLite backup created: {backup}")

    with sqlite3.connect(source) as sqlite_db:
        sqlite_db.row_factory = sqlite3.Row
        with monitor.conn() as pg:
            for table in TABLES:
                columns = source_columns[table]
                if not columns:
                    continue
                quoted_columns = ", ".join('"' + column.replace('"', '""') + '"' for column in columns)
                placeholders = ",".join("?" for _ in columns)
                query = f'INSERT INTO "{table}" ({quoted_columns}) VALUES ({placeholders})'
                rows = sqlite_db.execute(f'SELECT * FROM "{table}"').fetchall()
                if rows:
                    pg.executemany(query, (tuple(row) for row in rows))

            for table in SERIAL_TABLES:
                pg.execute(
                    f"""SELECT setval(pg_get_serial_sequence(?, 'id'),
                              GREATEST(COALESCE(MAX(id), 1), 1), COUNT(*) > 0)
                        FROM "{table}" """,
                    (table,),
                )

            copied_counts = {}
            for table in TABLES:
                row = pg.execute(f'SELECT COUNT(*) AS row_count FROM "{table}"').fetchone()
                copied_counts[table] = int(row["row_count"])
            if copied_counts != source_counts:
                raise RuntimeError(f"Row count mismatch; source={source_counts}, target={copied_counts}")

    print("Migration committed. Row counts match:")
    for table in TABLES:
        print(f"  {table}: {source_counts[table]}")
    print("SQLite was retained for rollback.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Migration failed: {type(error).__name__}: {error}", file=sys.stderr)
        raise
