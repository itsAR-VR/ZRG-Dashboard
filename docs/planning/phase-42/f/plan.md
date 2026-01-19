# Phase 42f — Concrete Repo Mapping + Patch Checklist (RED TEAM)

## Focus
Turn the Jan 19, 2026 production log signatures into a concrete, file-level patch list with explicit validations (so Phases 42a–42e can be executed without guesswork).

## Inputs
- Logs (Jan 19, 2026):
  - `refresh_token_not_found`
  - `Failed to get inbox counts: Error: Unauthorized`
  - `POST /` → `504 Gateway Timeout` at 5m/5m (request ID `hp74t-1768813460047-21e481a8c16a`)
  - Lead scoring `UND_ERR_BODY_TIMEOUT` + “incomplete JSON … retrying”
  - Prisma `P2002` on `BackgroundJob.dedupeKey`
  - EmailBison replies fetch `401` (“URL/key mismatch” hint)
- Verified touch points (repo reality):
  - Auth/session: `middleware.ts`, `lib/supabase/middleware.ts`, `lib/supabase/server.ts`, `lib/workspace-access.ts`, `actions/auth-actions.ts`
  - Inbox counts: `actions/lead-actions.ts:getInboxCounts()`
  - Background jobs: `prisma/schema.prisma` (`BackgroundJob.dedupeKey @unique`), `lib/background-jobs/enqueue.ts`, `lib/background-jobs/runner.ts`
  - Lead scoring enqueue: `lib/lead-scoring.ts:enqueueLeadScoringJob()`
  - Follow-ups cron: `app/api/cron/followups/route.ts`
  - EmailBison client + call sites: `lib/emailbison-api.ts`, `actions/email-campaign-actions.ts`, `actions/message-actions.ts`, `lib/reactivation-engine.ts`, `lib/background-jobs/email-inbound-post-process.ts`

## Work
### 1) Map each error signature → concrete code path
- `refresh_token_not_found`:
  - Identify which `supabase.auth.getUser()` call site is producing the error (middleware vs server actions).
  - Confirm whether the error is thrown vs returned as `error` (impacts where to catch).
- Inbox counts “Unauthorized”:
  - Confirm whether it originates from `resolveClientScope()` (`Unauthorized`) vs `requireAuthUser()` (`Not authenticated`).
- `P2002` on `BackgroundJob.dedupeKey`:
  - Confirm if it’s from `lib/lead-scoring.ts:enqueueLeadScoringJob()` (expected) or any other direct `backgroundJob.create`.
- `POST /` 5-minute timeout:
  - Identify the Server Action entrypoint that emits `[Sync] Fetching SMS history...` / `[EmailSync] Fetching conversation history...`.
  - Confirm whether it runs on page load (automatic) vs user-triggered sync, and why it’s on the request path.
  - Capture the long pole (GHL, EmailBison, OpenAI, or DB) and whether work can be made asynchronous.
- EmailBison `401`:
  - Confirm whether the failing endpoint is replies/sent-emails/leads search.
  - Confirm whether 401s are key-only (misconfig) vs URL/key mismatch (base URL issue).
- Lead scoring timeouts + incomplete JSON:
  - Confirm whether timeouts are from OpenAI call vs another upstream call in the scoring job path.

### 2) Patch list (ordered by blast radius)
1. **Inbox counts hardening**
   - Update `actions/lead-actions.ts:getInboxCounts()` to treat expected auth errors as normal empty-state (no error-level log spam).
   - Validation: signed-out request returns zeros without emitting error logs; signed-in still returns real counts.
2. **Lead scoring enqueue idempotency**
   - Replace “find then create” in `lib/lead-scoring.ts:enqueueLeadScoringJob()` with an atomic path (`enqueueBackgroundJob()` or `upsert`), treating duplicates as success.
   - Validation: concurrent enqueue attempts do not throw `P2002`.
3. **Supabase auth noise reduction**
   - Add explicit guards/handling for missing auth cookies so we don’t attempt refresh when the user is effectively signed out.
   - Validation: signed-out navigation does not generate repeated `refresh_token_not_found` logs; auth-required routes remain protected.
4. **EmailBison 401 mapping + timeouts**
   - Ensure all EmailBison HTTP calls use timeout-aware fetch and map 401s to actionable errors (include safe `endpoint + status`, no secrets).
   - Validation: a forced-401 test path produces a clear remediation message and does not trigger retries.
5. **`POST /` timeout mitigation**
   - Move long-running SMS/Email sync work off the request path:
     - enqueue BackgroundJobs and return immediately
     - keep manual sync available (it enqueues the same jobs)
   - Set `maxDuration = 800` where supported (route segment config) so any unavoidable long tasks don’t hard-timeout at 5 minutes.
   - Validation: the action returns quickly (< a few seconds) and work completes asynchronously without 5m gateway timeouts.
6. **Lead scoring timeout + JSON robustness**
   - Keep bounded timeouts/retries; ensure failures are retried/rescheduled via BackgroundJob runner without crashing the invocation.
   - Validation: simulated timeout triggers retry and records a safe error; no unhandled promise rejections.

## Output
- Executed the checklist items during Phase 42 implementation:
  1) Inbox counts hardening: `actions/lead-actions.ts:getInboxCounts()` now returns a safe empty-state for expected auth failures without error-level logs.
  2) Lead scoring enqueue idempotency: `lib/lead-scoring.ts:enqueueLeadScoringJob()` is now atomic (no race window / no `P2002` crashes).
  3) Supabase auth noise reduction: `lib/supabase/middleware.ts` skips auth network calls when no auth cookie is present and treats session-missing auth errors as signed-out; `lib/workspace-access.ts` avoids leaking Supabase auth errors as unhandled exceptions.
  4) EmailBison 401 mapping + safe logging: `lib/emailbison-api.ts` maps 401/403 across core endpoints to actionable errors, downgrades logs to warn-level diagnostics, and removes PII-heavy logging.
  6) Lead scoring timeout + retry behavior: undici body/header timeouts are treated as retryable; BackgroundJob retries are enabled for retryable failures (`lib/background-jobs/lead-scoring-post-process.ts`).

Note: Item (5) “POST / timeout mitigation” is partially addressed by reducing bulk-sync concurrency defaults and extending cron `maxDuration` ceilings; a full “off-request-path” design would require adding a dedicated job type or equivalent asynchronous mechanism (out of scope without a schema change).

## Handoff
- Proceed to Phase 42g to record the stakeholder clarification layer and explicitly note what was shipped vs deferred (notably per-workspace EmailBison base host selection and any remaining `POST /` timeout root-cause work).
