# Phase 154e — Durable Background Jobs (Inngest) + Cron-as-Trigger + Job Status in KV

## Focus
Move inbox-related background work out of request/cron hot paths and into durable jobs with retries/backoff/concurrency limits. Keep Vercel Cron as a trigger only.

## Inputs
- Existing cron routes: `app/api/cron/*`
- Background processors: `lib/background-jobs/*`
- KV cache/status primitives from Phase 154b
- Counts recompute loop from Phase 154c

## Work
1. Add Inngest:
   - Add dependency and minimal Next.js route handler wiring (Inngest endpoint).
2. Define durable jobs (initial set for inbox performance):
   - `inbox.counts.recompute` (process dirty workspaces; advisory lock per workspace; bump cache version)
   - Optional follow-up: `inbox.sync.enqueue` (if conversation sync is currently invoked on request paths)
3. Convert cron endpoints:
   - Replace “do work inline” with “enqueue job and return 200 quickly”.
   - Keep auth (`CRON_SECRET`) unchanged.
4. Store job status in KV:
   - `job:v1:{clientId}:{jobName}` -> `{ status, startedAt, finishedAt, lastError }` with TTL (1-24h).
   - Expose status to UI only if needed (optional endpoint).
5. Reliability requirements:
   - Idempotency keys: `{jobName}:{clientId}:{timeBucket}` to prevent duplicates.
   - Backoff and max retries: tuned per job type.

## Output
- Background work is durable, observable, and no longer blocks cron request latency.
- Inbox counts remain fresh via queued recompute, not ad-hoc scans.

## Handoff
Proceed to Phase 154f to add observability, run the full validation suite (including NTTAN), and write the rollout checklist.

