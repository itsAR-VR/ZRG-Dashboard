# Phase 42d — Lead Scoring Timeouts + JSON Robustness

## Focus
Stop lead scoring from failing due to network body timeouts and reduce “incomplete JSON” retries by enforcing explicit timeouts, bounded retries, and truncation-aware parsing.

## Inputs
- Vercel logs (Jan 19, 2026): `UND_ERR_BODY_TIMEOUT`, incomplete JSON retry logs
- Lead scoring implementation (Phase 33 semantics) and JSON parsing strategy (Phase 38)
- Any background job runner changes from Phase 42c

## Work
- Identify where the `BodyTimeoutError` is originating (provider call vs AI call) and set explicit timeouts at the call site.
- Add bounded retry logic for transient failures:
  - retry on timeout/5xx with backoff + jitter
  - cap total attempts and total wall time per job
- Apply truncation-aware JSON parsing and token/response sizing controls to reduce incomplete JSON outputs.
- Ensure the “no inbound messages” fast-path is applied before doing any network/AI work.
- Decide and implement a consistent failure mode:
  - reschedule job later (preferred) vs mark as failed/skipped with reason

## Output
- Hardened lead scoring against undici/OpenAI “terminated” body timeout failures:
  - Updated retryable detection in `lib/lead-scoring.ts` to treat `UND_ERR_BODY_TIMEOUT` / `UND_ERR_HEADERS_TIMEOUT` (including `error.cause.code`) as retryable.
  - Ensures the observed `TypeError: terminated` + `BodyTimeoutError` path is retried instead of immediately failing.
- Made lead scoring failure modes consistent and retryable at the BackgroundJob layer:
  - `scoreLeadFromConversation()` now throws non-parse errors after bounded internal retries and attaches a `retryable` flag to the thrown error.
  - `scoreLead()` now returns `{ success: false, retryable }` on scoring failures instead of collapsing into `{ success: true, score: null }` (which previously produced misleading “no inbound messages” logs).
  - `lib/background-jobs/lead-scoring-post-process.ts` now throws on retryable failures so the BackgroundJob runner reschedules with backoff (maxAttempts enforced), while non-retryable failures do not churn.

## Handoff
Proceed to Phase 42e to add regression coverage and a verification checklist for the full set of errors.
