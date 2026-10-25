# Match Monitor verification — 2026-10-20

## Automated verification

- `python -m pytest -q`: 15 tests passed.
- `node --test site/worker/test.mjs`: 6 tests passed.
- Sites Worker build and ESM artifact validation passed.

Covered: listed scores and 胜其他/平其他/负其他; Decimal monetary rounding; unauthenticated access rejection; documentation endpoints disabled; cross-origin write rejection; resume respecting a future start time; provider-controlled team identity; notification failure retaining a retryable task; postponed matches remaining active; AET/PEN regular-time score source; cancelled matches requiring manual review; ticket validation; atomic API budget reservation; Worker visitor requirement; missing configuration returning 503; proxy path allowlist; server-side credentials and no upstream redirects.

## Changes and operational limits

- Added a process-wide OS file lock for one poller per SQLite database; daily usage reservation uses a database transaction across processes.
- Telegram is at-least-once: delivery failure leaves the previous score/state to retry. A crash after successful delivery and before database commit can duplicate a notification.
- Paused/stopped tasks cannot have their state overwritten by a check already in flight. An already-started provider request/notification can finish; pause does not cancel network requests.
- Postponements continue polling; cancellation/abandonment/walkover requires official-announcement review, with no automatic refund or prize decision.
- Single-match correct-score calculations only. No accumulator, handicap, tax, refund or official prize validation.
- Separate legacy and new service usage is not included in one shared quota unless they share a quota store; configure budget accordingly.

## Not verified / launch gates

- No real API-Football request, Telegram message or remote backend installation was performed: new backend endpoint and secrets were not supplied.
- No continuous scheduler soak test, host restart test or live provider fixture transition test was performed.
- Browser visual QA was unavailable through the selected dependency-free Worker starter, which has no managed preview entrypoint. Responsive CSS is implemented; mobile/desktop visual acceptance remains pending.
- Before live monitoring: independently deploy backend, set strong credentials and HTTPS, configure Sites secrets, verify search/create/pause/resume on a non-sensitive fixture, check Telegram delivery, restart only the NEW service and verify persisted schedule, then observe a real final/abandoned/postponed fixture.

No amstd connection was made and no existing service was stopped, restarted, overwritten or modified. No real secrets or private tickets were used in tests or committed.

## 2026-10-20 Sites live proxy repair

Production logs identified `redirect: error` as unsupported by the edge runtime. Replaced it with `manual` and explicit 3xx rejection, preserving the restriction against forwarding credentials to redirect destinations. Added UTF-8 Basic encoding, a portable timeout controller and redacted failure diagnostics. Owner-private platform service access can probe `/api/health`; user records still require authenticated visitor identity.

Worker tests: 8 passed, including edge redirect compatibility and rejection of upstream redirects. Real backend connection verification is recorded in the deployment handoff.

## 2026-10-21 — Multi-market settlement and simulator

- Backend suite: `23 passed` with pytest. It covers all five single-match markets, half/full-time settlement, `7+` total goals, handicap adjustment, legacy correct-score JSON, 90-minute settlement during extra time, Chinese status labels, per-ticket stake/share/payout breakdown, suppressing repeated no-score Telegram notices, and migrating an existing SQLite task without losing its tickets.
- Frontend JavaScript: `node --check` passed.
- Sites Worker build, ESM artifact validation, and proxy/UI suite: `8 passed`. The tests cover the new simulator and JSON actions, private visitor checks, same-origin writes, route allowlisting, credentials kept server-side, UTF-8 Basic auth, and redirect rejection.
- Sites deployment: private version 5 succeeded at https://wellmax-match-monitor.letnek-majun.chatgpt.site.
- Simulator allocation was checked against the screenshot example (SP 13, 17, 24, 41, 55, 60, 19; budget ¥124): it allocates ¥32, ¥26, ¥18, ¥10, ¥8, ¥8, and ¥22 respectively, with gross returns ¥416, ¥442, ¥432, ¥410, ¥440, ¥480, and ¥418.

The user confirmed that backend commit `ca5b33d` is active and its authenticated health probe returned `ok: true` and `poller: true`. The OCR release below adds two new authenticated frontend-asset routes and still requires a separate pull/restart of only `sportsmatch-web.service`. This update did not trigger a real API-Football fixture update or Telegram message. No credentials or private betting data were added to the repository. The existing Napoli service was not accessed or changed.

## 2026-10-21 — Local screenshot OCR and mixed-market simulation

- Python/FastAPI suite: `25 passed`. Added authenticated checks for the two OCR script routes; existing settlement and scheduler tests also pass.
- Sites Worker suite: `9 passed`. Confirms the private Worker serves its page and OCR assets, preserves visitor/auth and proxy controls, and does not expose backend secrets.
- OCR parser suite: `4 passed`. Covers correct-score and other-score markets, 1X2, handicap inference, total goals, half/full, odds validation, full-width characters, selected-cell mapping, and matching root/Sites asset contents.
- `node --check` passed for the OCR parser, OCR UI and Sites Worker. Sites Worker build and ESM artifact validation passed; `git diff --check` passed.
- Screenshot processing uses Tesseract.js in the visitor's browser. The uploaded image is not sent to the backend or Site Worker and is not included in exported JSON. The OCR engine and Chinese language model are fetched from a pinned CDN on first use. Parsed market, selection, handicap, SP and selected-cell color remain editable; a confirmation checkbox is required to export and becomes unchecked after any edit.
- Browser-side OCR was not exercised end-to-end against a real screenshot in this environment. The selected Sites Worker starter has no managed preview entrypoint, and the Chinese trained data is not installed in the local Tesseract binary. Unit tests use representative OCR word boxes. CDN/CSP behavior and OCR accuracy still need a real browser check; manual entry remains available if recognition is unavailable or uncertain.

This change adds only frontend OCR asset routes; it does not alter database schema or schedule/settlement behavior. No screenshot, real betting record, API key, Telegram token or server credential was committed. It did not call API-Football or send Telegram messages, and did not access or alter `napoli-monitor.service`.

## 2026-10-21 — Upcoming order and finished-task retention

- Upcoming tasks in `pending` or `paused` state are returned first, ordered by `start_at` ascending. Other visible tasks retain their prior newest-created-first order.
- A normally finished task records `finished_at` when the backend first confirms a terminal provider status. It is hidden from `/api/tasks` at 24 hours after that timestamp; cancelled/abandoned tasks awaiting manual review are not treated as normally finished.
- Existing SQLite databases are migrated in place. For finished rows without `finished_at`, migration uses `last_check` (or `created_at` when no check time exists); task and ticket records are preserved.
- Python/FastAPI suite: `25 passed`, including mixed upcoming ordering, inclusion just before the 24-hour cutoff, exclusion after the cutoff, final-time capture, and legacy database migration.
- No Site source change was required because the Site renders `/api/tasks` in backend order. The already-published owner-private Site remains version 6. The final live page/OCR check is pending owner sign-in approval in the browser; no real screenshot was processed.
- The custom-domain backend still needs the documented `git pull --ff-only` and restart of only `sportsmatch-web.service` before this behavior is active there. `napoli-monitor.service` was not touched.

## 2026-10-21 — Screenshot-first simulator cleanup

- Removed the NetEase Betting Assistant URL field and its exported JSON property.
- The manual market, budget, selection table and simulation actions start hidden. They appear after an OCR attempt completes; successful recognition selects the first detected market. The visible “手动模拟” control and failed/empty OCR paths preserve manual entry.
- Verification: Python/FastAPI `25 passed`; Sites Worker `9 passed`; OCR parser `4 passed`; Worker/OCR JavaScript syntax checks passed. The Worker test checks the hidden initial state, removed link, and reveal/fallback hooks.
- The owner-private ChatGPT Site was published successfully at version 7: https://wellmax-match-monitor.letnek-majun.chatgpt.site
- Browser OCR was not exercised against a live screenshot in this pass. No screenshot, betting record, API key, Telegram token, or server credential was included in the source.

## 2026-10-21 — OCR option context and split recovery

- Fixed the selected-crop OCR call to pass the full-page OCR words and screenshot dimensions into candidate scoring. Without that context, a clipped label such as “负” could be evaluated under the wrong market before the row was parsed against the correct-score section.
- Narrowed the overlap between the option and SP OCR bands. The label pass now emphasizes the upper option line, while the odds pass emphasizes the lower SP line.
- Added regression cases for incomplete score labels and “负” versus “负其他”; incomplete labels lose to a valid label in the screenshot's “比分” context. The exact screenshot and its private ticket data are not used as fixtures or committed.
- Verification: `node --test tests/test_ocr_parser.mjs site/worker/test.mjs` — 21 passed; syntax checks, Sites Worker build, ESM artifact validation, and `git diff --check` passed.
- Browser OCR was not re-run against the original full-resolution betting screenshot because only the application screenshot with a small embedded preview was available. Test the same image again after the private Site update and inspect the four selected labels/SP values before use.
- Owner-private Site version 14 deployed successfully at https://wellmax-match-monitor.letnek-majun.chatgpt.site. The four-row output still needs confirmation using the original full-resolution screenshot.
- No backend, API-Football, Telegram, secrets, or amstd services were changed. `napoli-monitor.service` was not accessed.

## 2026-10-21 — `负其它` OCR spelling

- Added `它` to both OCR character whitelists. The prior whitelist contained `其他` but not `它`, so a screenshot label written as `负其它` could lose its ending and be returned as only `负`.
- OCR now joins character-split `负 / 其 / 它` and recognizes both `负其它` and `负其他`. The backend accepts both spellings and settles them against the same losing-team “other score” result while preserving the ticket's entered spelling in the detail row.
- Verification: Python/FastAPI `26 passed`; OCR and Sites Worker tests `24 passed` (12 Site Worker tests); Sites Worker build, ESM artifact validation, Python/JavaScript syntax checks, and `git diff --check` passed.
- The repository backend now accepts this alias, but the running `/opt/sportsmatch` service does not receive repository changes until it is updated and only `sportsmatch-web.service` is restarted. No existing service was remotely changed.
- Owner-private ChatGPT Site version 15 deployed successfully at https://wellmax-match-monitor.letnek-majun.chatgpt.site. Site access remains owner-only.
- No screenshot or ticket data was committed. Existing backend credentials, API-Football, Telegram, and amstd services were not touched; `napoli-monitor.service` was not accessed.

## 2026-10-21 — Screenshot SP list for “other score” settlement

- Screenshot OCR now builds a per-image exact-score list from all recognized correct-score rows that have a valid SP, including unselected rows. The list is editable so the user can correct OCR omissions or false detections before export.
- `胜其它` and `负其它` use the confirmed screenshot list as the `NOT IN` set. The confirmation is required when an OCR ticket contains either selection; the image itself remains browser-local.
- The screenshot JSON carries `listed_scores` and `listed_scores_verified` separately from selected tickets. The backend persists both fields, migrates existing SQLite databases additively, and only uses a verified list. Old/manual JSON without a screenshot list keeps the standard JCZQ option fallback.
- Added backend regression cases for exact scores included/excluded from the per-screenshot list, alias handling, list validation, and task persistence. Added OCR parser and Worker proxy tests for list extraction, editing controls, and metadata forwarding.
- Verification: Python source/test syntax and 10 isolated settlement/validation smoke checks passed; Node parser/Site Worker tests passed (`27/27`); the Site source Worker suite passed (`14/14`); `npm run build`, `npm run validate`, and `git diff --check` passed. The full Python/FastAPI pytest suite could not run in this environment because `pytest`, `fastapi`, and `httpx` are not installed. Browser OCR was not exercised against a real screenshot.
- Owner-private ChatGPT Site version 16 deployed successfully at https://wellmax-match-monitor.letnek-majun.chatgpt.site. The Site refuses to create screenshot-based “other score” tasks unless `/api/health` advertises `screenshot_score_lists`.
- The amstd backend has not been changed in this update. Pull this commit and restart only `sportsmatch-web.service` before using screenshot-based “胜其它／负其它” settlement. `napoli-monitor.service` was not accessed or changed; no secrets, screenshot, or private betting record were committed.

## 2026-10-21 — SP arrows and split decimals

- OCR now ignores known up/down arrow glyphs when parsing the numeric SP value, and the selected-cell odds OCR whitelist includes those glyphs so arrow-decorated odds remain available to the parser.
- OCR fragment merging now recovers decimals split as three tokens (for example `6`, `.`, `5`). This also restores `1:1` in the supplied screenshot's score list when its SP is segmented that way.
- Regression fixture covers all 28 exact correct-score outcomes shown in the screenshot layout, with attached and separate change arrows, decimal odds (`13.5` with a down arrow and split `6.5`), and confirms the full ordered list is emitted.
- Verification: OCR parser tests `14/14`; Sites Worker tests `14/14`; parser/UI JavaScript syntax checks passed. The uploaded screenshot and ticket information are not committed.
- Site Worker build, ESM artifact validation, and its 14 tests passed. Owner-private Site version 17 deployed successfully at https://wellmax-match-monitor.letnek-majun.chatgpt.site; access remains limited to the owner.

## 2026-10-21 — Correct-score grid OCR recovery

- The OCR now infers the standard 28-cell score table from recognized score-label positions and runs a separate enlarged SP read for each cell. A missed label is restored as an editable score candidate, including when its SP remains blank, so it is not silently omitted from review.
- Cell preprocessing converts dark selected cells to black-on-white and removes saturated arrow pixels before reading unselected odds. Whole-page and cell reads are reconciled using confidence; a cell decimal is preferred when it resolves a page-level missing decimal. Stray leading OCR dots are removed from numeric odds.
- The Sites Worker sync script now removes old copies of its OCR asset routes before inserting them. Running the sync twice leaves one route for each OCR asset.
- Verification: OCR parser tests `19/19`; Sites Worker tests `15/15`; JavaScript syntax checks and `git diff --check` passed. The tests cover 28-cell grid reconstruction from 17 sparse labels, retaining all 28 candidates when an SP read is blank, arrow-color removal, selected-cell inversion, and whole-page/cell odds reconciliation.
- Diagnostic on the supplied attachment: its original betting screenshot is only available as a small embedded preview inside a dashboard capture, not as the source image. A local English Tesseract CLI crop experiment could produce numeric reads for all 28 cells, but only 20 of 28 exactly matched the visible odds. This is not a browser OCR acceptance test: production uses Tesseract.js with Chinese and English trained data, and it must still be checked against the original full-resolution betting screenshot. The UI keeps all 28 inferred choices visible for review and requires confirmation before exporting screenshot-based “other score” tickets.
- Owner-private ChatGPT Site version 18 deployed successfully at https://wellmax-match-monitor.letnek-majun.chatgpt.site. Access remains limited to the owner.
- The attachment was not committed or sent to an external OCR service. No server was accessed; `sportsmatch-web.service` and `napoli-monitor.service` were not changed.

## 2026-10-21 — PaddleOCR.js screenshot OCR engine

- PaddleOCR.js 0.4.2 with PP-OCRv5 Chinese is now the primary browser-side OCR engine. It runs in a Web Worker where supported, retries in the browser main thread if Worker startup or recognition fails, and then falls back to the existing Tesseract.js path. Paddle results are normalized to the parser's word-box format. Score-cell crops are sent in batches to reduce repeated model calls.
- The screenshot remains in browser memory; only reviewed ticket JSON and an explicitly confirmed exact-score list are sent to the backend. The SDK, model, and WASM assets load from pinned public CDNs on first use. No API key or other secret was added.
- OCR parser tests: `21 passed`; Sites Worker tests: `15 passed`. `node --check` for OCR and Worker JavaScript, `python3 -m compileall -q app.py`, Sites Worker `npm run build`, `npm run validate`, and `git diff --check` passed. `pytest` is not installed in this environment, and no backend Python logic changed in this release.
- CDN module and model reachability plus cross-origin headers were checked. A browser end-to-end OCR run could not be completed in this environment, and the available attachment was a small dashboard preview rather than the full-resolution betting screenshot. Therefore these checks establish integration and delivery, not OCR accuracy or a measured recognition-rate improvement. The full-resolution screenshot is still needed for a valid before/after benchmark.
- Owner-private ChatGPT Site version 19 deployed successfully at https://wellmax-match-monitor.letnek-majun.chatgpt.site; access remains owner-only. Site Worker build and artifact validation passed.
- No screenshot, private betting record, API-Football key, Telegram token or server credential was committed. No server or API-Football/Telegram operation was performed. `napoli-monitor.service` was not accessed or changed.

## 2026-10-21 — PaddleOCR CSP and exact-score list correction

- The user's screenshot showed PaddleOCR falling back after a CSP violation. Inspection of the pinned OpenCV.js ESM asset found a generated `new Function` call. The Site page's `script-src` now permits `'unsafe-eval'` while retaining the existing explicit script, worker, and connection-source allowlists; no wildcard host was added. This weakens one CSP protection, so the Site remains owner-only.
- The screenshot's exact-score list is now assembled from parsed candidates, full-page OCR, selected-region OCR, and per-cell OCR. A regression case covers a selected score whose SP was recovered from its highlighted cell when the corresponding score-grid read is blank.
- Verification: OCR parser tests `22 passed`; Site Worker tests `15 passed`; JavaScript syntax checks, Python compile, Site Worker build, artifact validation, and `git diff --check` passed. The deployed owner-private page loaded in the connected browser, and Site access metadata confirmed one owner, zero groups, and zero external visitors.
- The browser-side OCR engine itself was not run end-to-end against a full-resolution betting screenshot in this turn. The attached image was a screenshot of the dashboard, not the original betting-page image, so no recognition-rate claim is made.
- Owner-private ChatGPT Site version 20 deployed successfully at https://wellmax-match-monitor.letnek-majun.chatgpt.site. No user screenshot or betting record was committed. No server was modified; `napoli-monitor.service` was not accessed or changed.

## 2026-10-21 — User-run PaddleOCR screenshot verification

- The user ran the deployed owner-private Site against a betting-page screenshot and shared the result screen. The UI reported PaddleOCR.js (PP-OCRv5, main thread), 31 candidates, seven detected highlighted regions, and seven generated bets; selected labels and SPs were both recognized 7/7.
- The same run reported per-cell odds at 28/28 and a complete exact-score list at 28/28. The seven selected rows and their odds are visible in the result screen, and the user said the recognition appeared complete and better than the previous engine.
- This is a successful live smoke test of the deployed browser OCR flow on one user-provided image. The result screen is not a retained original-image/ground-truth pair, so it does not establish a general accuracy rate. The uploaded image and private betting data were not committed.
- No production server, API-Football key, Telegram token, or `napoli-monitor.service` was accessed or changed.

## 2026-10-21 — Task-card and screenshot simulator layout

- Each monitoring task now shows a wager-count/total summary and a per-task “展开投注” control. Bet tables start collapsed, expose `aria-expanded`/`aria-controls`, and retain their open state across the 30-second task refresh.
- Finished-match tasks retain the four action buttons in a disabled gray state. Other task states keep their existing controls.
- When OCR has identified a selected wager, the lower manual market table stays hidden. The OCR panel now places a total-budget input immediately below the allocation instruction and to the left of “均衡分配识别项”; no-selection and error flows still expose manual mode.
- Verification: combined OCR parser and Sites Worker suite `39 passed` (22 parser, 17 Worker); JavaScript syntax checks, Python compile, Worker build, ESM artifact validation, and `git diff --check` passed. The Python `pytest` package is unavailable in this environment; no backend Python behavior changed.
- Owner-private ChatGPT Site version 21 deployed successfully at https://wellmax-match-monitor.letnek-majun.chatgpt.site. Site source commit: `75c595a28b28192a973b83e4b114fa16a60e28dd`.
- The custom-domain server was not accessed. To update its copy of the page, deploy the GitHub commit and restart only `sportsmatch-web.service`; `napoli-monitor.service` was not accessed or changed. No betting screenshot, API key, Telegram token, or server credential was committed.

## 2026-10-21 — OCR candidate total and JSON export

- The recognized-candidate panel now shows the selected ticket count and a prominent selected-stake total. It updates when a candidate is selected, deselected, or its stake changes, and resets when the screenshot is cleared.
- Added “下载所选 JSON” and “填入监测任务” actions next to the existing manual confirmation. Both use the same reviewed schema-v2 payload and validation: each selected stake and SP must be valid, and a confirmed full exact-score SP list is required when “胜其它／负其它” is selected. The generated `tickets`, `budget`, fixture metadata, and screenshot score list match the task import format.
- The Sites Worker source was regenerated from the canonical dashboard and OCR files; JavaScript syntax validation caught and removed a stale non-JavaScript output prefix in the generated worker.
- Verification: Node OCR parser and Sites Worker tests `39/39`; Python compile, JavaScript syntax checks, regenerated Worker syntax check, and `git diff --check` passed. The Python `pytest` suite could not run because `pytest` is not installed in this environment. No API, server, key, or screenshot was used.
- Owner-private ChatGPT Site version 22 deployed successfully at https://wellmax-match-monitor.letnek-majun.chatgpt.site; Site source commit: `11e7e4d78403270408ad102610ea863e5077c5ea`. Access remains owner-only.
- The custom-domain server was not accessed. After the GitHub update, deploy on amstd by pulling the commit and restarting only `sportsmatch-web.service`; `napoli-monitor.service` must remain untouched. No screenshot, private betting record, API-Football key, Telegram token, or server credential was committed.

## 2026-10-21 — Monitoring schedule changes and task deletion

- Task cards now include “调整计划” for eligible tasks, opening a Beijing-time start field and a 1–120 minute interval field. The backend requires a timezone-aware start and validates interval bounds; completed and review-required tasks reject plan edits. Editing a paused or stopped task does not reactivate it.
- Added confirmed task deletion through authenticated `DELETE /api/tasks/{id}`. The Sites proxy allows only the new schedule route and task DELETE method on its existing authenticated same-origin boundary.
- Polling and task mutations are serialized with a task lock. Polling reloads the task after acquiring the lock and skips deleted, paused, stopped, or no-longer-due rows; retry handling rechecks current task state and interval.
- Verification: OCR parser and Sites Worker tests `40/40`; JavaScript syntax checks, inline dashboard script syntax, Python compile, Worker syntax, and `git diff --check` passed. Python API tests were added for schedule validation/state preservation, finished-task rejection, deletion, and stale-poll safety, but could not run here because FastAPI, httpx, and pytest are unavailable in this environment.
- Owner-private ChatGPT Site version 23 deployed successfully at https://wellmax-match-monitor.letnek-majun.chatgpt.site; Site source commit: `aa453f91f0889e41bc49f45802a7f4bc04035d9f`. Access remains owner-only. The custom-domain server has not been changed. Do not alter `napoli-monitor.service`.


## 2026-10-21 — Dashboard two-column layout

- The top dashboard now uses two responsive columns: the left side stacks “查找比赛” and “创建监测任务”, while “监测任务” occupies the right side. A horizontal divider separates this area from the simulator.
- The simulator now spans the available page width as a single centered section. At viewport widths up to 900px, the upper dashboard collapses to one column.
- Verification: Node OCR parser and Sites Worker tests `41/41`, including DOM section order and responsive layout assertions. JavaScript syntax checks, Python compile, inline dashboard script syntax, and `git diff --check` passed. The targeted Python test could not run because `pytest` is not installed.
- Owner-only ChatGPT Site version 24 deployed successfully at https://bm.sendmymail.top and https://wellmax-match-monitor.letnek-majun.chatgpt.site. The connected custom domain and TLS status are active; the access allowlist contains only the owner. Site source commit: `e92a33d2df248d6e5816a8cc076b55d07ef49087`.
- `sportsmatch.sendmymail.top` is a separate amstd backend/frontend deployment and was not remotely changed in this update. No API key, Telegram token, betting data, or server credentials were included.

## 2026-10-21 — Highlight finished monitoring tasks

- Finished task cards now receive a pale yellow background with a light gold border and rounded inset spacing. The style is applied by task status; active tasks keep their existing appearance and finished-task controls remain disabled.
- Verification: Node OCR parser and Sites Worker tests `42/42`, including assertions for status-driven styling and disabled actions. JavaScript syntax checks, Python compile, and `git diff --check` passed. The targeted Python test could not run because `pytest` is not installed.
- Owner-only ChatGPT Site version 25 deployed successfully at https://bm.sendmymail.top and https://wellmax-match-monitor.letnek-majun.chatgpt.site. The custom domain and TLS are active; the allowlist contains only the owner. Site source commit: `f64dabf297bb942dfba193c3ffc31b9d9d55618a`.
- The separate amstd deployment at `sportsmatch.sendmymail.top` was not remotely updated. No screenshot, API key, Telegram token, betting data, or server credential was committed or used.

## 2026-10-21 — Per-market settlement and profit totals

- Task settlement now groups tickets by market and shows each market's stake, returned payout, and net profit, followed by the grand total. If any ticket within a market is unresolved (for example, a half-time/full-time bet without a halftime score), that market's net is shown as pending; the grand net also stays pending instead of treating unknown tickets as losses.
- The screenshot simulator subtracts only the selected market's stake when displaying per-ticket net profit and shows each market's own stake and estimated hit-profit range. The manual simulator now calculates each row against the complete stake total instead of a partial running total.
- Regression example: at 2:1, correct-score bets total ¥6, return ¥28, net +¥22; total-goals bets total ¥14, return ¥30, net +¥16. Combined stake ¥20, return ¥58, net +¥38.
- Verification: Node OCR parser and Sites Worker tests `43/43`, including an executable mixed-market grouping case; Site Worker tests `21/21`; Python compile, JavaScript syntax checks, Worker build, ESM artifact validation, and `git diff --check` passed. The host environment lacks FastAPI and pytest, so the full Python suite could not run. The exact production `outcome` function was exercised directly from its AST against the sample and pending halftime case; both passed.
- Owner-only ChatGPT Site version 26 deployed successfully at https://bm.sendmymail.top and https://wellmax-match-monitor.letnek-majun.chatgpt.site. The custom-domain live URL is `https://bm.sendmymail.top`; access remains limited to the owner. Site source commit: `81f93efe0957986c157af0eea2d8b2f172eb3122`. GitHub implementation commit: `d7e11dfb3abd55b3316c0dbd1167f33d74ba6496`.
- The amstd backend has not been updated from this commit yet; task-card grouping works from the existing ticket-level result payload, while the server update adds market summaries and correct pending-net semantics. No API key, Telegram token, private betting record, or server credential was committed. `napoli-monitor.service` was not accessed or changed.

## 2026-10-21 — Widen monitoring tasks column

- Desktop dashboard columns now allocate 40% to match search/task creation and 60% to monitoring tasks. The layout remains one column at viewport widths of 900px and below.
- Verification: OCR parser and Site Worker tests `43/43`; packaged Site Worker tests `21/21`; Worker syntax check, build, ESM artifact validation, and `git diff --check` passed.
- Owner-only Site version 27 deployed successfully at https://bm.sendmymail.top and https://wellmax-match-monitor.letnek-majun.chatgpt.site. Its access policy remains owner-only. Site source commit: `d383787f55a9aa991d6137010142ff0a2132c941`; GitHub layout commit: `0188166786146da65321d4ddc5fbb36c4053bcda`.
- No backend code or service was changed. `napoli-monitor.service` was not accessed or changed. No API key, Telegram token, screenshot, private betting record, or server credential was committed.

## 2026-10-21 — Downloadable bilingual betting plan image

- Each task card now offers “生成投注图片”. The browser renders and downloads a PNG showing Chinese and English team names, bilingual market headings, selections, per-ticket stake, and total stake; odds/SP values are not included, and the ticket data stays in the browser.
- The renderer groups mixed-play tickets, formats the kickoff time in Beijing time, and handles an empty wager list. Known clubs use local Chinese aliases; unrecognized names are labeled for translation review.
- Verification: OCR parser and Site Worker suite `45/45`; packaged Site Worker tests `23/23`; inline script and Worker syntax checks, Worker build, ESM artifact validation, and `git diff --check` passed. The renderer test executed the PNG creation/download path with sample data, checking bilingual team labels, grouped wagers, amounts, total, and no odds.
- Owner-only Site version 28 deployed at https://bm.sendmymail.top and https://wellmax-match-monitor.letnek-majun.chatgpt.site. Site source commit: `096acc9d4e53d0f1dc523a26117908a2b562b7a0`.
- GitHub implementation commits: `df228f1031c7b195b19d9487a3dca239c8f8a5aa`, `934871a934dd7ec7f735c7e5bbbd4bdd679ead7f`, and `70872766f3b6627d8e7cd4a0d82ee7974cce49e2`. No backend service was changed or restarted; `napoli-monitor.service` was not accessed or changed.


## 2026-10-21 — Completed-task image disable and screenshot drag-and-drop

- Regression coverage confirms that the “生成投注图片” button receives `disabled` for finished tasks and retains the gray disabled styling. The task status is also shown in the button tooltip.
- The OCR upload card accepts a single dropped file and retains click-to-select. Drag-enter/drag-over highlight the dropzone and set the copy cursor; drop clears the highlight, forwards the file through the same local preview and OCR path, and rejects multi-file drops. Only PNG, JPEG, and WebP are accepted, with the existing 15 MB cap.
- Verification: `node --test tests/test_ocr_parser.mjs site/worker/test.mjs` — 46/46 passed (22 parser, 24 Site Worker). `node --test worker/test.mjs` in the packaged Site checkout — 24/24 passed. `node --check` passed for `ocr-ui.js`, the Site Worker, and the inline dashboard script. Site Worker build and ESM artifact validation passed; `git diff --check` passed.
- Site owner-only version 29 deployed successfully at https://bm.sendmymail.top and https://wellmax-match-monitor.letnek-majun.chatgpt.site. Site source commit: `65cc01d97427b030ae42f078ae413c702cf92d78`. GitHub code commits: `e07752ae1dee11fb790fd3ed9e81ef5a5a5be082`, `9b469277e3e2c682ec05f2b47516d6317a88bd8b`, `6b008befca19c46f6bae74df77d83d738da64105`, and `c42a36d031bb477234d32702f53de7aa41a939fd`.
- This is a front-end-only change. The independent Python backend was not modified, and neither `sportsmatch-web.service` nor `napoli-monitor.service` was restarted. No API keys, Telegram tokens, server credentials, screenshots, or betting records were included.


## 2026-10-21 — Betting image width and kickoff timezone

- Reduced the generated PNG canvas width from 1080 px to 800 px and reflowed the poster into a narrower portrait layout. The image renderer still shows bilingual teams and markets, selections, ticket stakes, and total stake without SP values.
- Added a dedicated kickoff formatter: explicit UTC and offset timestamps are converted to `Asia/Shanghai`; timezone-less date-time input is interpreted as Beijing local time. The image labels the kickoff as “北京时间”.
- Verification: `node --test tests/test_ocr_parser.mjs site/worker/test.mjs` — 46/46 passed (22 parser, 24 Site Worker); the packaged Site Worker suite also passed 24/24. Regression tests verify UTC `13:00Z`, Beijing-local `21:00`, and offset-crossing examples all render correctly, and that the PNG canvas is 800 px wide and portrait. JavaScript syntax checks, Site Worker build, ESM artifact validation, and `git diff --check` passed.
- Owner-only ChatGPT Site version 30 deployed successfully at https://bm.sendmymail.top and https://wellmax-match-monitor.letnek-majun.chatgpt.site. Site source commit: `4f293f86500ae5daaade0d930ccf3680ddc1f64c`. GitHub implementation commits: `ff4b0ae749c37d4f940aac81bd7d9496915a6574`, `c1e08fa648c46d8d3ae7b30135c01a138ed6e790`, and `8296ba44a831ce91da2bf604ae3a8327c7465d30`.
- No backend service was touched or restarted, including `napoli-monitor.service`. No API keys, Telegram tokens, server credentials, betting screenshots, or private betting records were committed.

## 2026-10-21 — Beijing kickoff and competition identity

- Verified the reported `19:00` against the fixture identity: the poster is for Como U19 vs Manchester United U19 in the UEFA Youth League. The fixture is listed at 11:00 UTC, which is 19:00 in Beijing on Oct 21. The Chinese `周三004` 00:45 listing is the senior Como vs Manchester United UEFA Champions League fixture on Oct 22; these are separate matches. Sources: [Sofascore youth fixture](https://www.sofascore.com/football/match/como-u20-manchester-united-u19/YqYseAHb), [500.com Chinese lottery listing](https://app-live-m.500.com/home/zq/jczq/cur?fid=223584).
- Fixture search and creation now request `timezone=Asia/Shanghai`. The independent backend stores the competition name, migrates existing SQLite databases without deleting data, and backfills that name during the next normal poll for existing tasks. The dashboard, imported JSON, task cards, and generated ticket images identify the competition and label kickoff as Beijing time.
- Regression coverage checks the two distinct conversions (`11:00Z` → Oct 21 19:00 Beijing, `16:45Z` → Oct 22 00:45 Beijing), task creation/search timezone parameters, and legacy task competition backfill.
- Verification: Python backend suite `38 passed`; OCR parser and Site Worker suite `46/46`; Site Worker build and ESM artifact validation passed. No live backend credentials or fixture API keys were used.
- Owner-only ChatGPT Site version 31 deployed successfully at https://bm.sendmymail.top and https://wellmax-match-monitor.letnek-majun.chatgpt.site. Site source commit: `7dcc1c0dc807c8424fcc5f674fe9c99810f31e46`; access remains owner-only.
- The Site deployment updates the frontend. To apply the backend migration on amstd, pull the GitHub main commit and restart only `sportsmatch-web.service`; this session did not access or restart either service, and `napoli-monitor.service` remains untouched.

## 2026-10-21 — Chinese team names and crests in monitoring tasks

- The monitoring cards now use the supplied 347-team directory to show each club's Chinese name, original English name, and crest. Matching uses normalized English team names; U19 names can reuse the senior team's crest while preserving the U19 label.
- Crests load lazily from the directory's API-Football image host, with referrers disabled and a matching CSP image-host allowlist. The team directory is served as a separate same-origin asset by both the authenticated backend and Sites Worker; no API credentials or database migration are needed.
- Verification: `node --test tests/test_ocr_parser.mjs site/worker/test.mjs` — 47/47 passed, including 347-record map loading, Club Brugge KV/Lens Chinese names and crest URL, and the image-host CSP. Python backend suite: 39 passed. Site Worker build and ESM artifact validation passed; Python compile and `git diff --check` passed.
- Owner-only ChatGPT Site version 33 is live at https://bm.sendmymail.top; Site source commit: `f27eebb227c8c37726047e1c1c930a1f7b7bfce0`. The separate amstd backend code is included in GitHub; applying the direct-backend page update requires pulling the commit and restarting only `sportsmatch-web.service`. `napoli-monitor.service` was not accessed or changed.

## 2026-10-21 — Team logos in generated betting images

- The downloadable ticket-plan PNG now places the home and away team crests beside their Chinese and English names. The renderer loads the crests through the same-origin `/team-logo/{id}.png` route so canvas export remains valid; if a crest cannot load, the image still renders the team names and betting plan.
- Both the authenticated FastAPI backend and the Sites Worker restrict logo requests to the 347 IDs in the supplied team directory, fixed API-Football PNG URLs, GET requests, and a 2 MiB response limit. The Sites Worker no longer needs a third-party image host in its page CSP.
- Verification: `node --test site/worker/test.mjs tests/test_ocr_parser.mjs` — 49/49 passed, including proxy allowlist and rendered home/away crests. Python backend suite: 40 passed. Worker build/ESM validation, Python compile, `git diff --check`, and repeated Worker sync/idempotence checks passed.
- Owner-only ChatGPT Site version 34 deployed successfully at https://bm.sendmymail.top; the Site source commit is `5af92eb86f6adf2338f1e93a94eb5681d8e2a76f`. Access remains restricted to your account, with zero external visitors. The GitHub code commit is `362dac71cc15c4fad8bd1e0553f85081b4abd82f`.
- To enable the same-origin logo route on the direct amstd deployment, pull the GitHub update and restart only `sportsmatch-web.service`. This session did not access or restart server services; `napoli-monitor.service` was not changed.

## 2026-10-21 — Repair missing crests on the Site and ticket images

- Production Site Worker logs showed that `/team-logo/{id}.png` requests were returning HTTP 502, even though the authenticated server endpoint returned HTTP 200. The cause was the Site Worker fetching API-Football's image host directly.
- The Site Worker now requests allowlisted crests through the existing HTTPS backend route using server-side Basic authentication. It rejects redirects, non-PNG responses, invalid PNG signatures, and responses over 2 MiB. The browser and generated ticket image continue to use the same-origin route; no backend credentials are exposed to the page.
- Added regressions for the backend proxy URL and authentication, invalid/missing images, ID allowlisting, GET-only access, and the PNG signature. The Python backend also rejects upstream bodies that claim to be PNG but lack a PNG signature.
- Verification: `node --test site/worker/test.mjs tests/test_ocr_parser.mjs` — 49/49 passed; `node --check` passed for the worker and sync script; `python -m py_compile app.py` and `git diff --check` passed. The full Python pytest suite could not run because `pytest` is not installed in this environment. The server's existing authenticated logo endpoint had already returned HTTP 200 in the user's live check.
- Verification: the production page at `https://bm.sendmymail.top` reloaded and all four requested logo images completed with nonzero decoded dimensions. The deployed ticket-image renderer uses the same same-origin proxy; the regression test confirms both home and away logos reach `canvas.drawImage`.
- Owner-only ChatGPT Site version 35 is live at https://bm.sendmymail.top and https://wellmax-match-monitor.letnek-majun.chatgpt.site. Its access remains restricted to the owner, with zero external visitors and zero groups. Site source commit: `e8434cd2871513978794f3077df3b37492d0f6a9`. GitHub implementation commit: `43a4a9880bc2fd7c1c2b2e743a97a6f9885b3a50`.
- The Site uses the existing server-side `/team-logo/{id}.png` endpoint; no server service was restarted for this deployment. To apply the added invalid-PNG rejection in the backend source, pull the GitHub update and restart only `sportsmatch-web.service`. `napoli-monitor.service` was not accessed or changed. No API key, Telegram token, server credential, or betting record is included.

## 2026-10-21 — Match Monitor brand logo

- Replaced the text-only page header with the transparent Match Monitor brand mark. The responsive header keeps the logo readable on the dark navigation background using a compact white surface.
- Added a 207 KB transparent WebP asset. The Site Worker serves its embedded bytes from `/brand-logo.webp`; the standalone FastAPI app serves the same repository asset through an authenticated route. The browser never receives API or Telegram credentials.
- Verification: `node --test tests/test_ocr_parser.mjs site/worker/test.mjs` — 50/50 passed, including image MIME type, WebP signature, caching, single-route sync, and page reference checks. Site build and ESM artifact validation passed; `node --check`, Python byte-compilation, `git diff --check`, and repeated-sync checks passed. A 390px mobile viewport displayed the logo without horizontal overflow. The Python pytest suite could not run in this workspace because pytest and FastAPI are not installed.
- Owner-only ChatGPT Site version 37 is live at https://bm.sendmymail.top (canonical URL: https://wellmax-match-monitor.letnek-majun.chatgpt.site). Access remains restricted to the owner, with zero external visitors. Site source commit: `c4089ae2b752376087d2994d3994ef17c00bb6b4`.
- The backend service and `napoli-monitor.service` were not restarted or changed during this Site deployment. The backend logo route is included in GitHub source for the separate server deployment. No API key, Telegram token, server credential, or betting record is included.

## 2026-10-21 — Chinese team-name match search

- The search box resolves Chinese names from the bundled 347-team directory to API-Football names. Exact and unique partial names query the corresponding English name; ambiguous partial names fetch that date's fixture list once and filter locally. Search result cards show Chinese and English team names and crests.
- The backend fixture endpoint also supports exact and partial Chinese names for direct API callers after the backend source is deployed.
- Verification: `node --test tests/test_ocr_parser.mjs site/worker/test.mjs` — 51/51 passed. Packaged Site Worker tests — 29/29 passed. Inline page JavaScript, Worker, and sync-script syntax checks passed; the Worker built and validated as ESM. `python -m py_compile app.py tests/test_app.py` and `git diff --check` passed. A dependency-free harness exercised the backend route for Chinese exact, Chinese partial, ambiguous Chinese, English, and blank queries. The full pytest suite could not run because pytest and FastAPI are not installed here.
- Owner-only ChatGPT Site version 38 is live at https://bm.sendmymail.top. The private allowlist remains one owner, with no groups or external visitors. Site source commit: `17f7dfdbec82c958bbe005f686bb742a157a16f3`.
- The Site uses browser-side mapping, so Chinese searches work with the current backend. The separate backend was not restarted, and `napoli-monitor.service` was not accessed or changed. No API key, Telegram token, server credential, screenshot, or betting record was committed.

## 2026-10-22 — Betting image popup and local clipboard

- Monitoring-task image generation now displays the PNG in a modal preview instead of triggering a file download. Closing the modal clears the image element and revokes its temporary object URL.
- Manual simulator and screenshot-recognition JSON actions both copy validated task payloads to the browser's local clipboard. Clipboard API failures fall back to a temporary textarea copy; JSON download controls and file generation were removed.
- Verification: node --test site/worker/test.mjs tests/test_ocr_parser.mjs — 53/53 passed. Packaged Site Worker tests — 31/31 passed. Regressions cover popup content, close cleanup, bilingual teams/logos, selected amounts without SP, modern clipboard write, fallback copy, and removal of JSON download actions.
- node --check passed for the inline dashboard script, ocr-ui.js, generated Worker, and Worker sync script. npm run build --prefix site and npm run validate --prefix site passed. git diff --check passed.
- Owner-only Site version 39 deployed successfully at https://bm.sendmymail.top; canonical Site URL: https://wellmax-match-monitor.letnek-majun.chatgpt.site. The access policy remains custom with only the owner, zero groups, and zero external visitors. Site source commit: e2310cceb87ac7c93d5f6f02e5c930ea66e3285a.
- No server service was accessed or restarted, including sportsmatch-web.service and napoli-monitor.service. No API keys, Telegram tokens, server credentials, screenshots, or private betting records were added.

## 2026-10-22 — Inline monitoring-task bet editing

- Added per-row stake/SP inputs and Save/Delete actions to the expanded task bet breakdown. Saves and deletes submit through the same-origin, authenticated ticket endpoint; the backend recalculates payout and net profit. Finished tasks lock these controls. Input validation requires stake in positive 2-yuan units and SP ≥ 1.
- Regression coverage exercises the actual rendered row handlers, verifies updated stake/SP payloads, deletion of the selected ticket only, finished-row locking, and authenticated Worker forwarding.
- `node --test site/worker/test.mjs tests/test_ocr_parser.mjs`: 56/56 passed. Packaged Site Worker: 34/34 passed. JavaScript syntax, Python byte-compilation, Site build, ESM artifact validation, and `git diff --check` passed. Full pytest tests were unavailable because pytest and FastAPI are not installed in this workspace.
- Deployed owner-only Site version 40 to https://bm.sendmymail.top; canonical URL: https://wellmax-match-monitor.letnek-majun.chatgpt.site. The access policy remains custom with one owner, no groups, and no external visitors. Site source commit: `3e66708040a71cf42490464b38b422eefecd7be6`.
- No backend service was changed or restarted, including `sportsmatch-web.service` and `napoli-monitor.service`. No secrets, server credentials, screenshots, or private betting records were included.

## 2026-10-22 — Compact monitoring-task bet columns

- Narrowed the amount, share, and SP columns in expanded task details, reduced inline input width on phones, and allowed long bet labels and result text to wrap.
- Verification: `node --test tests/test_ocr_parser.mjs site/worker/test.mjs` — 58/58 passed; packaged Site Worker tests — 36/36 passed. Site Worker build and ESM validation, JavaScript syntax checks, Python byte-compilation, and `git diff --check` passed. Backend pytest could not run because pytest, FastAPI, and httpx are not installed in this workspace.
- Deployed owner-only Site version 43 to https://bm.sendmymail.top (canonical URL: https://wellmax-match-monitor.letnek-majun.chatgpt.site). Access remains limited to the owner, with no groups or external visitors.
- The separate amstd backend was not accessed or restarted. Pull the GitHub main commit and restart only `sportsmatch-web.service` to apply this page change there.

## 2026-10-23 — Beijing default monitoring start time

- Selecting a fixture with an available kickoff time now sets the monitoring start input to kickoff + 120 minutes in Asia/Shanghai. Importing a task-ready JSON object with a fixture ID and kickoff time applies the same default. The user can still change the time manually.
- Regression coverage verifies a UTC kickoff at `2026-10-23T19:00:00Z` becomes `2026-10-24T05:00` Beijing time, as well as an explicit `+08:00` input and an invalid-time fallback.
- Verification: `node --test tests/test_ocr_parser.mjs site/worker/test.mjs` — 59/59 passed; packaged Site Worker — 37/37 passed; Site build and ESM artifact validation passed. JavaScript syntax checks, Python byte-compilation, and `git diff --check` passed.
- Deployed owner-only ChatGPT Site version 44 at https://bm.sendmymail.top (canonical URL: https://wellmax-match-monitor.letnek-majun.chatgpt.site). The amstd backend was not changed or restarted; pull the new GitHub `main` commit and restart only `sportsmatch-web.service` to apply this default there.

## 2026-10-23 — Match search defaults to tomorrow

- The fixture search date now defaults to tomorrow in Asia/Shanghai and remains editable. This uses Beijing calendar dates rather than the browser's local timezone.
- Regression coverage verifies the normal day rollover and the year boundary.
- Verification: `node --test tests/test_ocr_parser.mjs site/worker/test.mjs` — 60/60 passed; packaged Site Worker — 38/38 passed; Site build and ESM artifact validation passed. JavaScript syntax checks and `git diff --check` passed.
- Deployed owner-only ChatGPT Site version 45 at https://bm.sendmymail.top (canonical URL: https://wellmax-match-monitor.letnek-majun.chatgpt.site). The amstd backend was not restarted.

## 2026-10-25 — Add Fagiano Okayama to the team directory

- Added Fagiano Okayama / 冈山绿雉 as a Japan J1 team under API-Football team ID `310`, with the supplied HTTPS Wikimedia crest URL. Chinese fixture search resolves to `Fagiano Okayama`, and the registered crest uses the authenticated same-origin `/team-logo/310.png` proxy.
- Verification: `node --test tests/test_ocr_parser.mjs site/worker/test.mjs` — 60/60 passed; packaged Site Worker — 38/38 passed; Python byte-compilation, JavaScript syntax check, and `git diff --check` passed. Targeted backend pytest could not run because pytest is not installed in this workspace.
- Deployed owner-only ChatGPT Site version 46 at https://bm.sendmymail.top (canonical URL: https://wellmax-match-monitor.letnek-majun.chatgpt.site). The amstd backend was not restarted.

## 2026-10-25 — Fix self-hosted write-origin configuration guidance

- The task-creation error `Cross-origin write denied` comes from the FastAPI origin guard when a browser write's `Origin` does not exactly match `PUBLIC_ORIGIN`. Added the required self-hosted origin to `.env.example`, documented the exact production value and trailing-slash constraint, and added a regression test for an allowed UI origin while retaining rejection of other origins.
- Verification: packaged Site Worker tests — 38/38 passed; Python byte-compilation, JavaScript syntax check, and `git diff --check` passed. Backend pytest could not run because pytest and FastAPI are not installed in this workspace.
- The server's `/opt/sportsmatch/.env` and `sportsmatch-web.service` were not accessible from this workspace and were not changed or restarted. To restore task creation, set `PUBLIC_ORIGIN=https://sportsmatch.sendmymail.top` in the server `.env` and restart only `sportsmatch-web.service`. The legacy `napoli-monitor.service` was not touched.

## 2026-10-25 — Recognize selected total-goals cells in screenshot OCR

- Color selection detection now separates saturated red betting cells from the adjacent green vertical market label. Vertical Chinese heading fragments such as `总` / `进` / `球` are grouped to provide `总进球` context for the selected number and its SP.
- Regression coverage includes the uploaded total-goals screenshot layout: selected 3, 4, and 5 cells, with green header excluded, plus vertical-heading classification and number/SP parsing.
- The uploaded screenshot's selected-cell detector returned three separate red regions and no green/neutral false selection. This validates selection isolation; PaddleOCR inference against the live browser image was not run in this workspace.
- Verification: `node --test tests/test_ocr_parser.mjs site/worker/test.mjs` — 62/62 passed; Site Worker tests — 38/38 passed; Site build and ESM validation, Python byte-compilation, JavaScript syntax checks, and `git diff --check` passed.
- Owner-only ChatGPT Site version 47 deployed successfully at https://bm.sendmymail.top (canonical URL: https://wellmax-match-monitor.letnek-majun.chatgpt.site). Access remains limited to the owner, with no groups or external visitors.
- The separate amstd server was not accessed, and neither `sportsmatch-web.service` nor `napoli-monitor.service` was changed or restarted. No screenshot, credentials, API keys, Telegram tokens, or betting records were committed.

## 2026-10-25 — Standalone parlay monitoring

- Backend scenarios cover the sample 2串1 ticket (5×, ¥10 stake, ¥18.65 return, ¥8.65 profit), a losing leg, 3串4 constituent-combination settlement, cross-market reuse of existing total-goals watchers, shared-task pause/delete protection, invalid-fixture confirmation, and automatic cleanup of score-only watchers created solely for a parlay.
- Browser parser test extracts both matches, “主胜” selections, SP 1.220/1.530, 2串1, five multiples, ¥10 total, and ¥18.65 declared top prize. The Site Worker proxy tests owner authentication, scoped parlay paths, same-origin writes, and forwarding without exposing backend credentials.
- Verification: `uv run --with 'fastapi>=0.115,<1' --with httpx --with pytest python -m pytest tests/test_app.py -q` — 58 passed; `node --test site/worker/test.mjs tests/test_ocr_parser.mjs` — 64 passed; isolated Site Worker tests — 40 passed; Site build and artifact validation, Python byte-compilation, JavaScript syntax checks, and `git diff --check` passed.
- Owner-only Site version 48 deployed successfully at https://bm.sendmymail.top (canonical URL: https://wellmax-match-monitor.letnek-majun.chatgpt.site), Site source commit `903bf46b301904b97f7bac3d7aa48d0a65ab12a9`. Access remains limited to the owner, with zero groups and zero external visitors.
- The live Site frontend is updated; the amstd Python backend still needs the GitHub update and restart of `sportsmatch-web.service` before `/api/parlays` becomes available. The server was not accessed, and neither `sportsmatch-web.service` nor `napoli-monitor.service` was changed. No secrets, screenshots, or private betting records were committed.

## 2026-10-25 — Full pass-mode variants and final Site deployment

- Added full-subset pass modes 2串3, 3串7, 4串15, 5串31, 6串63, and 8串255 (7串127 was already present), with a backend test confirming each mode generates every 1-to-n subset and the expected `2^n - 1` combination count.
- Final verification: backend pytest — 59 passed; `node --test site/worker/test.mjs tests/test_ocr_parser.mjs` — 65 passed; packaged Site Worker — 41 passed; Site build and ESM artifact validation, Python byte-compilation, JS syntax checks, and `git diff --check` passed.
- Owner-only ChatGPT Site version 49 deployed successfully at https://bm.sendmymail.top (canonical URL: https://wellmax-match-monitor.letnek-majun.chatgpt.site), source commit `e3147f67f827dd965899c6e2d9da37db6115587c`. Access remains owner-only.
- amstd remains unchanged. Pull the resulting GitHub commit and restart only `sportsmatch-web.service` to enable the backend endpoints. `napoli-monitor.service` was not accessed or modified; no secrets, tokens, credentials, screenshots, or private betting records were committed.

## 2026-10-25 — Stop monitoring combinations that can no longer win

- A combination is settled as soon as any required leg is confirmed lost. If the first leg wins, a two-leg 2串1 ticket remains pending for the second result. If the first leg loses, the other fixture no longer needs polling; the UI labels it “本票无需继续等待”. A parlay-only watcher is stopped automatically, while a task reused by single-match monitoring or another unresolved combination stays active.
- System tickets keep monitoring only fixtures still used by a pending or reviewable combination. A regression test verifies that one loss in a three-leg 3串3 ticket eliminates two combinations but preserves the remaining combination's watchers.
- Verification: `uv run --with 'fastapi>=0.115,<1' --with httpx --with pytest python -m pytest tests/test_app.py -q` — 62 passed; Python byte-compilation, JavaScript syntax checks, and `git diff --check` passed. The Site frontend did not change in this update.
- The amstd server was not accessed. Apply this backend change by pulling GitHub `main` and restarting only `sportsmatch-web.service`; `napoli-monitor.service` remains untouched.
