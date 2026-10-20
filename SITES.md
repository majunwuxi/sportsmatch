# ChatGPT Sites — deployment assessment and handoff

## Architecture

Sites hosts `site/worker/index.js`: the Chinese responsive dashboard and same-origin server-side API proxy. Sites runtime supports secret environment variables and authenticated visitor headers. The Site remains owner-private; publication does not mean public sharing.

The Python scheduler stays in a separate always-on service. Available Sites documentation establishes Workers HTTP execution, but not a durable minute-frequency scheduler for this Python application. Do not run a daemon thread in a Worker or depend on an open browser tab for polling.

## Runtime secrets (never commit values)

Sites: `BACKEND_URL` (HTTPS origin), `BACKEND_USER`, `BACKEND_PASSWORD` (mark all secret).
Independent backend: `APISPORTS_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ADMIN_USER`, `ADMIN_PASSWORD`, `DATABASE_PATH`, `ENABLE_POLLER=true`, `API_DAILY_LIMIT`. Use a dedicated service account and a separate API quota/key when possible.

The browser cannot supply upstream credentials or a target URL. The proxy only accepts known API paths, requires Sites visitor identity, checks write origins, refuses HTTP backends and redirects, and does not reflect upstream error URLs. Keep owner-only access. For future multi-user sharing add record ownership; the current backend is a single-account administration service.

## Current status

Site project: `appgprj_6ad718b88cd8819195c1d2b1773221ad`.
Expected origin: https://wellmax-match-monitor.letnek-majun.chatgpt.site . Deployment success must be confirmed separately by Sites.

No independent backend URL or credentials were provided in this session. Therefore real fixture searches, persistent task operations, unattended polling and Telegram delivery are NOT live-verified. The interface explicitly reports this state. The single-match correct-score calculator and JSON export work independently. Do not report the whole platform as operational before backend configuration and live acceptance tests.

Configure the independent service first, verify it over HTTPS, then set Sites secrets and redeploy. Do not change or restart `napoli-monitor.service`. Never copy its files or credentials. See TEST_REPORT.md for verification and remaining gates.
