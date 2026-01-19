# Phase 42c — Background Job Enqueue Idempotency + Vercel Timeout Reduction

## Focus
Eliminate Prisma `P2002` crashes on `BackgroundJob.dedupeKey` and remove any remaining synchronous long-running work on request paths (notably the `POST /` Server Action timeout) by offloading to BackgroundJobs with explicit time budgets.

## Inputs
- Vercel logs (Jan 19, 2026):
  - Prisma `P2002` on `BackgroundJob.dedupeKey`
  - `POST /` → `504 Gateway Timeout` at 5m/5m (request ID `hp74t-1768813460047-21e481a8c16a`) with SMS + Email sync log prefixes
- Background job schema + enqueue utilities (Prisma model + any helpers in `lib/`)
- Phase 35 plan (webhook→background-jobs refactor) for intended architecture
- Stakeholder decision (Jan 19, 2026): enqueue BackgroundJobs (return fast) and keep manual sync available

## Work
- Identify each background job enqueue call site that can race (e.g., Email post-process enqueue, webhook fan-out, cron loops).
- Make enqueue idempotent by design:
  - prefer `upsert` by `dedupeKey` (or `createMany({ skipDuplicates: true })` where appropriate)
  - treat “already enqueued” as success (no `[error]` logs)
- Identify the Server Action behind the `POST /` timeout:
  - locate the code emitting `[Sync] Fetching SMS history...` and `[EmailSync] Fetching conversation history...`
  - confirm what triggers it (page load vs user click) and why it runs on the request path
- Offload long-running sync work to BackgroundJobs:
  - enqueue work and return immediately (no 5m request path work)
  - keep a manual “Sync” trigger that enqueues the same job(s)
  - add strict per-invocation budgets for any remaining on-request work (best-effort, timeboxed)
- Extend Vercel function runtimes where applicable:
  - Ensure any long-running API routes have `export const maxDuration = 800` (where supported by Vercel plan).
  - For the `POST /` Server Action route segment: set route segment `maxDuration = 800` if supported (still prefer BG jobs so the request returns quickly).
  - Note: this refers to Vercel runtime only; keep internal HTTP/OpenAI timeouts bounded and rely on BackgroundJobs + retries.
- Ensure cron/job-runner endpoints short-circuit near time budget (still required for reliability, but not the primary 5m timeout driver).
- Add minimal job telemetry to link timeouts to specific job types and leads (without PII).

## Output
- Lead scoring enqueue is now idempotent under concurrency (no `P2002` on `BackgroundJob.dedupeKey`):
  - Replaced the non-atomic “find then create” pattern in `lib/lead-scoring.ts:enqueueLeadScoringJob()` with a single `create()` guarded by `isPrismaUniqueConstraintError()` (duplicates treated as “already enqueued”).
  - Removes the observed error path from `lib/background-jobs/email-inbound-post-process.ts` that logged `P2002` when concurrent enqueue attempts raced.
- Reduced likelihood of 5-minute Server Action timeouts during bulk conversation sync:
  - Changed the default `SYNC_ALL_CONCURRENCY` fallback from `3` → `1` in `actions/message-actions.ts:syncAllConversations()` so the `maxSeconds` budget is less likely to be exceeded by a slow concurrent batch.
- Extended Vercel runtime ceiling for long-running cron routes (while still preferring bounded work):
  - Added `export const maxDuration = 800` to `app/api/cron/followups/route.ts`.
  - Added `export const maxDuration = 800` to `app/api/cron/reactivations/route.ts`.

## Handoff
Proceed to Phase 42d to harden lead scoring execution against upstream/body timeouts and make failures retryable without crashing the job runner.
