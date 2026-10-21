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
