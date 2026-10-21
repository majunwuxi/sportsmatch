# ChatGPT Sites — deployment assessment and handoff

## Architecture

Sites hosts `site/worker/index.js`: the Chinese responsive dashboard and same-origin server-side API proxy. Sites runtime supports secret environment variables and authenticated visitor headers. The Site remains owner-private; publication does not mean public sharing. The page includes the multi-market simulator, task settlement details, and browser-local screenshot OCR. Current scores appear beside the teams.

The Python scheduler stays in a separate always-on service. Available Sites documentation establishes Workers HTTP execution, but not a durable minute-frequency scheduler for this Python application. Do not run a daemon thread in a Worker or depend on an open browser tab for polling. The backend settles five single-match markets; live goals and the regular-time score used for lottery settlement are stored separately.

## Runtime secrets (never commit values)

Sites: `BACKEND_URL` (HTTPS origin), `BACKEND_USER`, `BACKEND_PASSWORD` (mark all secret).
Independent backend: `APISPORTS_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ADMIN_USER`, `ADMIN_PASSWORD`, `DATABASE_PATH`, `ENABLE_POLLER=true`, `API_DAILY_LIMIT`. Use a dedicated service account and a separate API quota/key when possible.

The browser cannot supply upstream credentials or a target URL. The proxy only accepts known API paths, requires Sites visitor identity, checks write origins, refuses HTTP backends and redirects, and does not reflect upstream error URLs. Keep owner-only access. For future multi-user sharing add record ownership; the current backend is a single-account administration service.

## Current status

Site project: `appgprj_6ad718b88cd8819195c1d2b1773221ad`.
Owner-private URL: https://wellmax-match-monitor.letnek-majun.chatgpt.site . Version 16 was deployed on 2026-10-21.

The independent backend was previously confirmed healthy with the poller enabled. Site version 16 now builds an editable per-screenshot list of exact-score SP options and requires a user confirmation when settling “胜其它／负其它”. The Site checks `/api/health` for `screenshot_score_lists` support before creating such a task, so the backend must be upgraded from the matching GitHub commit and only `sportsmatch-web.service` restarted first. No real API-Football result transition or Telegram message was triggered during this update.

NetEase Betting Assistant URLs are retained as source references only; the Site does not fetch those pages or scrape official odds. A screenshot can be processed in the browser using Tesseract.js and a Chinese language model fetched from the pinned CDN. The image is not sent to the Site Worker or backend. OCR proposes supported markets, selections, displayed SPs and highlighted cells; the user can review or edit both selected bets and the full exact-score SP list before export. If the CDN is unavailable or OCR is uncertain, manual entry remains available.

Keep the existing backend secrets in their current server-side environment. Follow DEPLOY.md to update only `sportsmatch-web.service`; do not change, stop, restart, or overwrite `napoli-monitor.service`. Never copy its files or credentials. See TEST_REPORT.md for automated verification and remaining live checks.
