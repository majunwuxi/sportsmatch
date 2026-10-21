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
