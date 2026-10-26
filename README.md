# Match Monitor

A Chinese-language football, NBA, and WNBA match monitoring dashboard using API-Football, BallDontLie, and Telegram, with persisted match tasks and Chinese Sports Lottery settlement.

## Status

The dashboard is published as an owner-private ChatGPT Site. Its always-on scheduler runs in a separate `sportsmatch-web.service` on `amstd`. Never alter the existing `napoli-monitor.service`.

## Features

- Search fixtures by date and team name using API-Football; show the competition to distinguish youth and senior teams
- Search NBA and WNBA games by date and team in English or Chinese through BallDontLie
- Default basketball monitoring's first check to 2 hours 30 minutes after kickoff
- Settle the four single-game JC Basketball markets: result, handicap result, over/under total, and winning margin; use the final score including overtime
- Create 2–8 game basketball parlays with system-pass combinations, mixed basketball markets, per-leg ticket lines/SP, and shared NBA/WNBA score monitors; football and basketball legs cannot be mixed on one ticket
- Maintain all 30 NBA and 15 current WNBA teams with Chinese names and official CDN logos
- Request and store fixture kickoff timestamps in `Asia/Shanghai`; display every kickoff with an explicit Beijing-time label
- Create monitoring tasks with start time (Asia/Shanghai) and interval; multiple matches supported
- Create standalone pass-ticket monitors by adding match legs from fixture search or parsing ticket/OCR text into a review table; bind every leg to an API-Football or BallDontLie fixture before creating it
- Reuse any existing match watcher for parlay legs, regardless of whether that watcher tracks correct score, result, handicap, total goals, or half/full time; missing fixtures receive one score-only watcher
- Set pass type and multiples, calculate system-pass combinations, stake, and per-combination payout; settle each winning combination separately and report combined return/net profit
- Require manual confirmation before voiding an invalid or abandoned fixture; Telegram reports changes when the ticket settles
- Show upcoming tasks first in kickoff-time order; hide finished matches 24 hours after the backend first confirms their terminal result
- Import/export ticket JSON; support `胜平负`, `让球胜平负`, 31 correct-score selections including `胜其他`, `平其他`, `负其他` and the equivalent `其它` spellings, `总进球`, and `半全场`
- Simulate manually by market, or upload a soccer betting-page screenshot or Chinese Sports Lottery basketball receipt for browser-local OCR; review every selection and SP, then balance a shared ¥2-unit budget
- Build a per-screenshot list of every recognized exact-score option with SP, separate from the user's selected bets; `胜其它`/`负其它` settle only when the final score is not in that confirmed list
- Show live scores separately from the 90-minute settlement score so extra time and penalties do not change JCZQ results
- Check scores on a persistent SQLite-backed schedule; Telegram alerts at first check, score changes, and full time
- HTTP Basic authentication; API keys only from server environment variables
- Keep BallDontLie requests at least 12.5 seconds apart to stay within its documented Free-plan rate limit
- API daily call budget guard and graceful error recording

Basketball ticket JSON records the ticket's actual SP and, for handicap/total markets, its signed home adjustment or points line. Basketball pass tickets reuse existing match monitors when possible and default new match monitors to kickoff plus 150 minutes. See `.env.example`, `app.py` and `DEPLOY.md`.

ChatGPT Sites can be evaluated for the frontend, but this Python background scheduler requires an always-on runtime. See `SITES.md`.

## ChatGPT Site

The owner-private Sites dashboard lives under `site/`; see SITES.md and TEST_REPORT.md. Screenshot and basketball receipt OCR run in the user's browser and only send reviewed bet data to the backend; the image itself is not uploaded. Basketball receipt parsing extracts its market, teams, selection, SP, issue and total stake; the sample currently verified is a winning-margin receipt. The parlay text parser also runs locally and requires each team to be bound to a real fixture. The editable exact-score list is built from all recognized exact-score/SP candidates, not only selected bets. PaddleOCR.js 0.4.2 with PP-OCRv5 runs as the primary browser OCR engine; its package, model files, and WASM runtime are fetched from pinned public CDNs on first use. Tesseract.js remains a fallback. Confirm every parsed market, selection, SP and (when using an “other” score bet) the complete exact-score list before creating a monitor. The backend does not scrape NetEase or fetch official odds. After backend changes, follow DEPLOY.md to restart only `sportsmatch-web.service`.
