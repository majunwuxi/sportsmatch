# Match Monitor

A Chinese-language football match monitoring dashboard using API-Football and Telegram, with persisted tasks and single-match Chinese Sports Lottery settlement.

## Status

The dashboard is published as an owner-private ChatGPT Site. Its always-on scheduler runs in a separate `sportsmatch-web.service` on `amstd`. Never alter the existing `napoli-monitor.service`.

## Features

- Search fixtures by date and team name using API-Football
- Create monitoring tasks with start time (Asia/Shanghai) and interval; multiple matches supported
- Show upcoming tasks first in kickoff-time order; hide finished matches 24 hours after the backend first confirms their terminal result
- Import/export ticket JSON; support `胜平负`, `让球胜平负`, 31 correct-score selections including `胜其他`, `平其他`, `负其他`, `总进球`, and `半全场`
- Simulate manually by market, or upload a NetEase Betting Assistant screenshot for browser-local OCR across markets; review each selection and SP, then balance a shared ¥2-unit budget
- Show live scores separately from the 90-minute settlement score so extra time and penalties do not change JCZQ results
- Check scores on a persistent SQLite-backed schedule; Telegram alerts at first check, score changes, and full time
- HTTP Basic authentication; API keys only from server environment variables
- API daily call budget guard and graceful error recording

See `.env.example`, `app.py` and `DEPLOY.md`.

ChatGPT Sites can be evaluated for the frontend, but this Python background scheduler requires an always-on runtime. See `SITES.md`.

## ChatGPT Site

The owner-private Sites dashboard lives under `site/`; see SITES.md and TEST_REPORT.md. Screenshot OCR runs in the user's browser and only sends the reviewed ticket JSON to the backend; the screenshot itself is not uploaded. OCR engine and Chinese language data are downloaded from the configured CDN on first use. Confirm every parsed market, selection and SP before exporting. The backend does not scrape NetEase or fetch official odds. After backend changes, follow DEPLOY.md to restart only `sportsmatch-web.service`.
