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

The live backend was previously configured and its authenticated health probe succeeded with the poller enabled. The new backend source still needs to be pulled and `sportsmatch-web.service` restarted as documented in DEPLOY.md. Until that step, the newly added markets are not active through the production API. This release did not trigger a real API-Football fixture update or Telegram message. No credentials or private betting data were added to the repository. The existing Napoli service was not accessed or changed.
