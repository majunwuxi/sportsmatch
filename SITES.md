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
Owner-private URL: https://wellmax-match-monitor.letnek-majun.chatgpt.site . Version 20, deployed 2026-10-21, fixes the PaddleOCR.js/OpenCV CSP block and merges screenshot SP reads across OCR sources.

The OCR grid-recovery pipeline fits the standard 28-cell correct-score table from recognized score labels, reads each SP from a separate enlarged cell crop, removes colored change-arrow pixels, and normalizes white-on-dark selected cells. If an SP still cannot be read, its inferred score remains as an editable blank candidate instead of disappearing. Page-level and cell-level odds are reconciled by confidence, with decimal readings preferred when the digits otherwise match. It requires a user confirmation when settling “胜其它／负其它”. The Site checks `/api/health` for `screenshot_score_lists` support before creating such a task, so the backend must be upgraded from the matching GitHub commit and only `sportsmatch-web.service` restarted first. No real API-Football result transition or Telegram message was triggered during this update.

The Site does not fetch NetEase pages or scrape official odds. A screenshot can be processed in the browser using PaddleOCR.js 0.4.2 with the Chinese PP-OCRv5 model; Tesseract.js remains a fallback. The SDK, model files and WASM runtime load from pinned public CDNs on first use. The image is not sent to the Site Worker or backend. OCR proposes supported markets, selections, displayed SPs and highlighted cells; the user can review or edit both selected bets and the full exact-score SP list before export. The exact-score list merges valid SP reads from full-page OCR, selected-region OCR, and per-cell OCR so a missed cell read can be filled by another OCR pass. OpenCV.js uses `new Function`, so the page CSP permits `'unsafe-eval'` while keeping its explicit source allowlist; this is a security tradeoff, and the Site remains owner-only. If the CDN is unavailable or OCR is uncertain, manual entry remains available. A recognition-rate improvement has not yet been measured against a full-resolution betting screenshot; see TEST_REPORT.md.

Keep the existing backend secrets in their current server-side environment. Follow DEPLOY.md to update only `sportsmatch-web.service`; do not change, stop, restart, or overwrite `napoli-monitor.service`. Never copy its files or credentials. See TEST_REPORT.md for automated verification and remaining live checks.
