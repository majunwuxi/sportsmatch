# Match Monitor

A lightweight Chinese-language football match monitoring dashboard using API-Football and Telegram, with persisted tasks and Chinese Sports Lottery correct-score ticket settlement.

## Status

MVP development. **Not deployed**. Existing `/opt/napoli-monitor` service on `amstd` must remain untouched. New app uses a separate directory, port, and systemd unit.

## Features

- Search fixtures by date and team name using API-Football
- Create monitoring tasks with start time (Asia/Shanghai) and interval; multiple matches supported
- Import/export ticket JSON, correctly classify Chinese JCZQ `胜其他`
- Check scores on a persistent SQLite-backed schedule; Telegram alerts at first check, score changes, and full time
- HTTP Basic authentication; API keys only from server environment variables
- API daily call budget guard and graceful error recording

See `.env.example`, `app.py` and `DEPLOY.md`.

ChatGPT Sites can be evaluated for the frontend, but this Python background scheduler requires an always-on runtime. See `SITES.md`.
