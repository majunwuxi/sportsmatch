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
Owner-only Site URLs: https://bm.sendmymail.top (active custom domain) and https://wellmax-match-monitor.letnek-majun.chatgpt.site. Version 30 is deployed as of 2026-10-21; each task can generate and download a local PNG betting plan with bilingual team names, market groups, selections, and stake amounts, without SP values. Finished tasks now disable that image action, and the OCR screenshot area accepts image drag-and-drop. Version 27 widened the desktop monitoring column to 60% while preserving the mobile single-column layout. Version 26 added per-market settlement totals. The allowlist contains only the owner.

The OCR grid-recovery pipeline fits the standard 28-cell correct-score table from recognized score labels, reads each SP from a separate enlarged cell crop, removes colored change-arrow pixels, and normalizes white-on-dark selected cells. If an SP still cannot be read, its inferred score remains as an editable blank candidate instead of disappearing. Page-level and cell-level odds are reconciled by confidence, with decimal readings preferred when the digits otherwise match. It requires a user confirmation when settling “胜其它／负其它”. The Site checks `/api/health` for `screenshot_score_lists` support before creating such a task, so the backend must be upgraded from the matching GitHub commit and only `sportsmatch-web.service` restarted first. No real API-Football result transition or Telegram message was triggered during this update.

The Site does not fetch NetEase pages or scrape official odds. A screenshot can be processed in the browser using PaddleOCR.js 0.4.2 with the Chinese PP-OCRv5 model; Tesseract.js remains a fallback. The SDK, model files and WASM runtime load from pinned public CDNs on first use. The image is not sent to the Site Worker or backend. OCR proposes supported markets, selections, displayed SPs and highlighted cells; the user can review or edit both selected bets and the full exact-score SP list before export. The exact-score list merges valid SP reads from full-page OCR, selected-region OCR, and per-cell OCR so a missed cell read can be filled by another OCR pass. OpenCV.js uses `new Function`, so the page CSP permits `'unsafe-eval'` while keeping its explicit source allowlist; this is a security tradeoff, and the Site remains owner-only. If the CDN is unavailable or OCR is uncertain, manual entry remains available. A user-run browser test with a betting-page screenshot reported 7/7 selected bets and SPs, all 28/28 score-cell SPs, and a complete 28/28 exact-score list. This confirms the live PaddleOCR path for that screenshot; it is a single-image test, not a statistical accuracy benchmark. See TEST_REPORT.md.

Task cards summarize the wager count and total while keeping each bet table collapsed by default. Expansion state survives the 30-second refresh. Finished tasks keep their four action buttons visible but disabled and gray. After OCR identifies selected wagers, the manual market table stays hidden; the OCR budget input sits beside “均衡分配识别项”. Users can still open manual mode when OCR does not identify a selection.

Version 26 adds market-by-market settlement: each task shows stake, payout, and net profit for every market, then sums market profit for the overall result. An unresolved ticket leaves that market's net pending, and the overall net stays pending until all tickets are resolved. The OCR simulator also computes profit after subtracting only that market's stake. The 2:1 regression scenario returns +¥22 for correct score and +¥16 for total goals, for a combined +¥38 net from ¥20 stake. The deployed version is owner-only at https://bm.sendmymail.top and https://wellmax-match-monitor.letnek-majun.chatgpt.site; Site source commit: `81f93efe0957986c157af0eea2d8b2f172eb3122`. The corresponding GitHub implementation commit is `d7e11dfb3abd55b3316c0dbd1167f33d74ba6496`.

Keep the existing backend secrets in their current server-side environment. Follow DEPLOY.md to update only `sportsmatch-web.service`; do not change, stop, restart, or overwrite `napoli-monitor.service`. Never copy its files or credentials. See TEST_REPORT.md for automated verification and remaining live checks.

## 2026-10-21 — Widen monitoring tasks column

- Desktop dashboard columns now allocate 40% to match search/task creation and 60% to monitoring tasks. The existing breakpoint still switches the dashboard to one column at 900px and below.
- Verification: OCR parser and Site Worker tests `43/43`; packaged Site Worker tests `21/21`; Worker syntax check, build, ESM artifact validation, and `git diff --check` passed.
- Owner-only Site version 27 is active at https://bm.sendmymail.top and https://wellmax-match-monitor.letnek-majun.chatgpt.site. The access policy remains custom with one owner and no groups or external visitors. Site source commit: `d383787f55a9aa991d6137010142ff0a2132c941`. GitHub layout commit: `0188166786146da65321d4ddc5fbb36c4053bcda`.
- This is a dashboard layout update only. The separate amstd backend was not changed or restarted, and `napoli-monitor.service` was not accessed or changed. No secrets, screenshots, or private betting records were committed.

## 2026-10-21 — Downloadable bilingual betting plan image

- Each monitoring task now has a “生成投注图片” action that creates and downloads a locally rendered PNG. It displays Chinese and English team names, bilingual market headings, each selection and stake, and the total stake. It does not render odds/SP values or upload ticket data. Known club names use a bundled Chinese alias map; an unknown name is labeled “中文译名待补”.
- The poster uses a responsive portrait layout with a dark green title band, match card, grouped market cards, and a total-stake panel. It also handles tasks with no imported wagers.
- Verification: OCR parser and Site Worker tests `45/45`; packaged Site Worker tests `23/23`; inline script and Worker syntax checks, Worker build, ESM artifact validation, and `git diff --check` passed. A renderer test exercised the PNG download path and confirmed bilingual labels, wager names, amounts, and omission of odds.
- Owner-only Site version 28 is active at https://bm.sendmymail.top and https://wellmax-match-monitor.letnek-majun.chatgpt.site. Access remains one owner, zero groups, and zero external visitors. Site source commit: `096acc9d4e53d0f1dc523a26117908a2b562b7a0`.
- GitHub implementation commits: `df228f1031c7b195b19d9487a3dca239c8f8a5aa` (dashboard), `934871a934dd7ec7f735c7e5bbbd4bdd679ead7f` (Site Worker), and `70872766f3b6627d8e7cd4a0d82ee7974cce49e2` (tests). This update does not change the independent backend or any server service; `napoli-monitor.service` remains untouched.


## 2026-10-21 — Finished-task image action and screenshot drag-and-drop

- “生成投注图片” is disabled and gray when a match is finished; the title explains why it is unavailable. Other task states retain the local PNG action.
- The screenshot upload area now accepts one PNG, JPEG, or WebP image by drop or by clicking to choose a file. The area highlights while a file is dragged over it, rejects multiple files, and keeps the existing 15 MB limit and browser-local OCR flow. File names and image bytes are not sent to the backend.
- Verification: combined OCR parser and Site Worker tests `46/46` (22 parser, 24 Worker); packaged Site Worker tests `24/24`; JavaScript syntax checks, Worker build, ESM artifact validation, and `git diff --check` passed. Drag events were exercised with a mocked dropzone; the deployment completed successfully.
- Owner-only Site version 29 is active at https://bm.sendmymail.top and https://wellmax-match-monitor.letnek-majun.chatgpt.site. The access mode remains custom with one owner and no groups or external visitors. Site source commit: `65cc01d97427b030ae42f078ae413c702cf92d78`.
- GitHub implementation commits: `e07752ae1dee11fb790fd3ed9e81ef5a5a5be082` (dashboard), `9b469277e3e2c682ec05f2b47516d6317a88bd8b` (drop handling), `6b008befca19c46f6bae74df77d83d738da64105` (Site Worker), and `c42a36d031bb477234d32702f53de7aa41a939fd` (tests). No backend code or server service was changed; `napoli-monitor.service` was not accessed or modified. No secrets, screenshots, or betting records were committed.


## 2026-10-21 — Narrower betting-plan image and Beijing kickoff time

- The betting-plan PNG is now a narrower portrait image, 800 px wide (previously 1080 px). The match card and wager rows were reflowed for the narrower canvas while keeping the bilingual teams, market groups, selections, stakes, and total readable.
- Kickoff time is explicitly labeled Beijing time. ISO timestamps with `Z` or an offset are converted to `Asia/Shanghai`; zone-less date-time strings are treated as Beijing wall time so the visitor's browser timezone cannot shift them.
- Verification: OCR parser and Site Worker tests `46/46`; packaged Worker tests `24/24`. Tests compare UTC, explicit-offset, and zone-less examples, assert the rendered kickoff label, and verify the exported canvas is 800 px wide and portrait. Worker build, ESM artifact validation, syntax checks, and `git diff --check` passed.
- Owner-only Site version 30 is active at https://bm.sendmymail.top and https://wellmax-match-monitor.letnek-majun.chatgpt.site. Site access remains custom/owner-only with one owner and zero external viewers. Site source commit: `4f293f86500ae5daaade0d930ccf3680ddc1f64c`.
- GitHub implementation commits: `ff4b0ae749c37d4f940aac81bd7d9496915a6574` (dashboard), `c1e08fa648c46d8d3ae7b30135c01a138ed6e790` (Site Worker), and `8296ba44a831ce91da2bf604ae3a8327c7465d30` (tests). No backend code or server service changed; `napoli-monitor.service` was not accessed or modified.
