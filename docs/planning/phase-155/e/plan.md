# Phase 155e — Durable Background Work with Inngest (Retries/Backoff/Status)

## Focus
Move counts/analytics recompute out of request and cron hot paths into durable Inngest functions with idempotency, retry control, and observable status.

## Inputs
- Existing cron trigger routes in `app/api/cron/*`.
- Existing recompute logic from Phase 155b and 155d.
- Redis status/version primitives in `lib/redis.ts`.

## Work
1. **Inngest foundation**
   - Completed in repo:
     - dependency `inngest`
     - route handler `app/api/inngest/route.ts` (`GET/POST/PUT` via `serve`)
     - client `lib/inngest/client.ts` with Production env pinning
     - function scaffold `lib/inngest/functions/process-background-jobs.ts`

2. **Define event contracts**
   - `inbox/counts.dirty`
   - `inbox/counts.recompute`
   - `analytics/aggregates.recompute` (optional path gated by SLO miss)
   - Include payload fields:
     - `clientId`
     - `requestId`
     - `source`
     - optional `priority`

3. **Implement durable functions**
   - `inbox-counts-recompute` function:
     - lock/idempotency by `clientId + time bucket`
     - run recompute
     - bump `inbox:v1:ver:{clientId}`
     - clear dirty marker
   - `analytics-recompute` function (if enabled):
     - refresh aggregates/version
     - bump `analytics:v1:ver:{clientId}`

4. **Cron role**
   - Cron routes enqueue events only (no heavy recompute execution inside cron request lifecycle).
   - Do not enable `BACKGROUND_JOBS_USE_INNGEST=true` broadly until Phase 155g ports cron maintenance parity into Inngest.

5. **Status visibility**
   - Write job status blob to Redis:
     - `job:v1:{clientId}:{jobName}`
   - Include:
     - `status`
     - `startedAt`
     - `finishedAt`
     - `durationMs`
     - `attempt`
     - `lastError`

6. **Reliability controls**
   - Retries with exponential backoff.
   - Dead-letter/final-failure logging path.
   - Concurrency caps per job type.
   - Idempotency for duplicate event deliveries.

## Validation
- Trigger dirty event and confirm recompute runs to completion.
- Retry path verified by forced transient failure.
- Duplicate events do not double-apply updates.
- Queue backlog remains within alert threshold during canary.

## Output
- Durable recompute pipeline is Inngest-driven and observable.
- Cron endpoints are lightweight and predictable.

## Handoff
Proceed to Phase 155f for React #301 closure, observability baseline enforcement, and release sign-off.

## Progress This Turn (2026-02-16)
- Added Inngest foundation wiring in code:
  - Dependency: `inngest`
  - Route handler: `app/api/inngest/route.ts` (`GET/POST/PUT` via `serve`)
  - Client: `lib/inngest/client.ts`
  - Event constant: `lib/inngest/events.ts`
  - Function registry + durable function scaffold:
    - `lib/inngest/functions/index.ts`
    - `lib/inngest/functions/process-background-jobs.ts`
- Added cron-trigger integration gate:
  - `app/api/cron/background-jobs/route.ts` now supports `BACKGROUND_JOBS_USE_INNGEST=true` to enqueue event `background/process.requested` and return `202`.
  - Existing inline processing remains default fallback (`BACKGROUND_JOBS_USE_INNGEST=false`) to avoid rollout breakage.
- Added setup docs:
  - `README.md` env vars and Inngest setup/troubleshooting section.
  - Local helper script: `npm run inngest:dev`.
- Verification:
  - `npm run typecheck` passed.
  - `npm run build` passed and includes `/api/inngest`.
  - `npm run lint` passed with pre-existing warnings.
- Live endpoint checks:
  - `https://zrg-dashboard.vercel.app/api/inngest` returns `200` and reports `x-inngest-env: production`.
  - Inngest onboarding “Invoke your function” step can error, but manual event send `background/process.requested` successfully triggers `process-background-jobs` runs in Production.
  - `https://zrg-dashboard-zrg.vercel.app` remains Vercel-protected (`401`) and must not be used for Inngest sync.
