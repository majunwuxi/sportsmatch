"""Collect the 500.com sale-day listing and fill missing Sportsmatch numbers."""
import argparse
import json
import re
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from html import unescape
from pathlib import Path
from urllib.request import urlopen
from zoneinfo import ZoneInfo

BEIJING = ZoneInfo("Asia/Shanghai")
PAGES = {
    "football": "https://app-live-m.500.com/home/zq/jczq/cur",
    "basketball": "https://app-live-m.500.com/home/lq/jclq/cur",
}
NUMBER = r"周[一二三四五六日天][0-9]{3}(?![0-9])"


def clean(fragment):
    fragment = re.sub(r"<em\b[^>]*>.*?</em>", "", fragment, flags=re.S)
    return " ".join(unescape(re.sub(r"<[^>]+>", "", fragment)).split())


def fields(card, name):
    pattern = rf'<div\b[^>]*\bclass="[^"]*\b{name}\b[^"]*"[^>]*>(.*?)</div>'
    return [clean(value) for value in re.findall(pattern, card, re.S)]


def parse_page(html, sport, sale_day):
    prefix = "周" + "一二三四五六日"[sale_day.weekday()]
    expected = {number.replace("周天", "周日") for number in re.findall(NUMBER, html)}
    expected = {number for number in expected if number.startswith(prefix)}
    records = {}
    cards = re.findall(r'<li\b[^>]*\bclass="[^"]*\bone-game\b[^"]*"[^>]*>(.*?)</li>', html, re.S)
    for card in cards:
        headings = fields(card, "game-info-l")
        heading = re.fullmatch(rf"({NUMBER})\s*(.+)", headings[0]) if headings else None
        if not heading:
            continue
        number, league = heading.groups()
        number = number.replace("周天", "周日")
        if number not in expected:
            continue
        teams = fields(card, "game-name")
        times = fields(card, "game-info-r")
        event = re.search(rf"/detail/{sport}/([0-9]+)/", card)
        if len(teams) != 2 or not all(teams) or len(times) != 1 or not event:
            raise ValueError(f"{number}: incomplete match card")
        time = re.fullmatch(r"([0-9]{2}-[0-9]{2}) ([0-9]{2}:[0-9]{2})", times[0])
        if not time:
            raise ValueError(f"{number}: invalid kickoff {times[0]!r}")
        day = next((d for d in (sale_day, sale_day + timedelta(days=1))
                    if d.strftime("%m-%d") == time[1]), None)
        if day is None:
            raise ValueError(f"{number}: kickoff outside sale-day window")
        kickoff = datetime.fromisoformat(f"{day}T{time[2]}").replace(tzinfo=BEIJING)
        row = dict(number=number, league=league, teams=teams, kickoff=kickoff.isoformat(),
                   source_id=event[1], sport=sport)
        if number in records and records[number] != row:
            raise ValueError(f"{number}: conflicting match cards")
        records[number] = row

    if not expected or set(records) != expected:
        raise ValueError(f"missing or unconfirmed listing: {sorted(expected - records.keys())}")
    if len({row["source_id"] for row in records.values()}) != len(records):
        raise ValueError("multiple numbers for the same source match")
    return [records[number] for number in sorted(records)]


def fetch_page(url):
    with urlopen(url, timeout=20) as response:
        body = response.read(8_000_001)
        if len(body) > 8_000_000:
            raise ValueError("schedule exceeds size limit")
        return body.decode(response.headers.get_content_charset() or "utf-8")


def normalize(value):
    return " ".join(value.strip().lower().split())


def match_key(fixture):
    kickoff = datetime.fromisoformat(fixture["kickoff"])
    if kickoff.utcoffset() is None:
        raise ValueError("provider kickoff has no timezone")
    utc = kickoff.astimezone(timezone.utc).isoformat(timespec="milliseconds")
    return "|".join((fixture["sport"], normalize(fixture["home"]),
                     normalize(fixture["away"]), utc.replace("+00:00", "Z")))


def match_rows(app, rows):
    aliases = defaultdict(set)
    for team in app.team_directory_by_id().values():
        if team.get("name_en") and team.get("name_zh"):
            aliases[normalize(team["name_en"])].add(normalize(team["name_zh"]))
    cache = {}
    errors = {}
    for row in rows:
        sport = row["sport"]
        league = row["league"].upper()
        if sport == "basketball" and not re.match(r"^(WNBA|NBA)(?:$|杯|季|常|总|\s)", league):
            row["status"] = "unsupported_league"
            continue
        league_code = "wnba" if league.startswith("WNBA") else "nba"
        kickoff = datetime.fromisoformat(row["kickoff"])
        group = (sport, kickoff.date(), league_code)
        if group not in cache:
            try:
                cache[group] = app.fixtures(date=kickoff.date().isoformat(), q="",
                                            sport=sport, league_code=league_code)
            except Exception as error:
                cache[group] = None
                label = f"{sport}/{league_code}/{kickoff.date()}" if sport == "basketball" else f"{sport}/{kickoff.date()}"
                errors[label] = f"{type(error).__name__}: {error}"
        if cache[group] is None:
            row["status"] = "provider_error"
            continue
        targets = {normalize(team) for team in row["teams"]}
        candidates = {}
        for fixture in cache[group]:
            try:
                key = match_key(fixture)
            except (ValueError, TypeError, KeyError):
                continue
            if datetime.fromisoformat(fixture["kickoff"]) != kickoff:
                continue
            names = []
            for side in ("home", "away"):
                name = normalize(fixture[side])
                names.append({name} | aliases[name] |
                             {normalize(fixture.get(side + "_cn") or "")})
            # 500 presents the teams in different orders across sports.
            if len(targets) == 2 and names[0] & targets and names[1] & targets and (
                (names[0] & targets) | (names[1] & targets)
            ) == targets:
                candidates[key] = fixture
        if len(candidates) == 1:
            row["match_key"], fixture = next(iter(candidates.items()))
            row["home"], row["away"] = fixture["home"], fixture["away"]
            row["status"] = "matched"
        else:
            row["status"] = "ambiguous" if candidates else "unmatched"

    counts = Counter(row["match_key"] for row in rows if row["status"] == "matched")
    for row in rows:
        if row["status"] == "matched" and counts[row["match_key"]] > 1:
            row["status"] = "ambiguous"
    return errors


def save_numbers(app, rows):
    with app.conn() as db:
        for row in rows:
            if row["status"] != "matched":
                continue
            key, number = row["match_key"], row["number"]
            updated = db.execute(
                "INSERT INTO sporttery_match_numbers(match_key,number,updated_at) "
                "VALUES(?,?,CAST(CURRENT_TIMESTAMP AS TEXT)) "
                "ON CONFLICT(match_key) DO NOTHING", (key, number),
            )
            saved = db.execute("SELECT number FROM sporttery_match_numbers WHERE match_key=?",
                               (key,)).fetchone()["number"]
            row["status"] = ("inserted" if updated.rowcount == 1 else
                             "already_present" if saved == number else "preserved_existing")
            row["saved_number"] = saved


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--sale-day", type=date.fromisoformat, default=datetime.now(BEIJING).date())
    cli.add_argument("--apply", action="store_true", help="fill missing numbers")
    cli.add_argument("--report-dir", type=Path)
    args = cli.parse_args()
    rows, errors = [], {}
    for sport, url in PAGES.items():
        try:
            rows.extend(parse_page(fetch_page(url), sport, args.sale_day))
        except (OSError, ValueError) as error:
            errors[sport] = str(error)
    if rows:
        import app
        try:
            errors.update(match_rows(app, rows))
            if args.apply:
                save_numbers(app, rows)
        except Exception as error:
            errors["integration"] = f"{type(error).__name__}: {error}"
    report = dict(sale_day=str(args.sale_day), sources=PAGES, apply=args.apply,
                  counts=dict(Counter(row["status"] for row in rows if "status" in row)),
                  errors=errors, matches=rows)
    output = json.dumps(report, ensure_ascii=False, indent=2)
    print(output)
    if args.report_dir:
        args.report_dir.mkdir(parents=True, exist_ok=True)
        filename = args.report_dir / f"{args.sale_day}-{datetime.now(BEIJING):%H%M%S%f}.json"
        filename.write_text(output + "\n", encoding="utf-8")
    return int(bool(errors))


if __name__ == "__main__":
    raise SystemExit(main())
