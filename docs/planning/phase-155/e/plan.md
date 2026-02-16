# Phase 155e — Durable Background Jobs (Inngest) for Recompute/Aggregates + Status Visibility

## Focus
Move recompute work off request/cron hot paths and into durable jobs with retries/backoff and predictable throughput. Keep Vercel cron as a trigger only.

## Inputs
- Existing cron routes in `app/api/cron/*`
- Redis (Upstash) for:
  - cache versions (`inbox:v1:ver:{clientId}`, `analytics:v1:ver:{clientId}`)
  - job status keys
- Postgres recompute functions from Phase 155b/155d (counts and optional analytics aggregates)

## Work
1. Add Inngest to the repo (standard pattern for Next.js App Router)
   - Define a single Inngest client and handler route.
   - Ensure secrets/env vars are stored in Vercel (never in repo).

2. Implement jobs
   1) `recompute-inbox-counts`
   - Trigger: cron endpoint or scheduled event.
   - Steps:
     - lock per clientId (avoid concurrent recompute per workspace)
     - pull N dirty workspaces (oldest first)
     - recompute counts
     - clear dirty marker
     - `INCR inbox:v1:ver:{clientId}`

   2) `recompute-analytics-aggregates` (optional, only if Phase 155d needs derived tables)
   - Trigger: cron endpoint or scheduled event.
   - Steps:
     - recompute last N days for active workspaces
     - `INCR analytics:v1:ver:{clientId}`

3. Status visibility
   - Write a small JSON status blob to Redis:
     - `jobs:v1:{jobName}:{clientId}`
     - fields: `lastStartedAt`, `lastFinishedAt`, `lastStatus`, `lastError`, `durationMs`, `attempt`
   - This allows UI/admin views (later) and operational debugging.

4. Cron-as-trigger
   - Update cron routes to enqueue Inngest jobs rather than doing heavy work inline.
   - Preserve existing auth (`CRON_SECRET`) semantics.

5. Verification
   - Ensure jobs are idempotent and safe to retry.
   - Ensure lock strategy prevents overlap without deadlocks.

## Output
- Durable recompute jobs exist with retries/backoff and concurrency control.
- Cron routes are lightweight triggers.
- Job status is visible via Redis keys.

## Handoff
Proceed to Phase 155f to finish React #301 closure with targeted instrumentation and workspace-switch verification.

