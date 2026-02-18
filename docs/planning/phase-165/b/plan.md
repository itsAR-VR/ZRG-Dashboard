# Phase 165b — Database Reliability Model + Migration Plan

## Focus
Design a production-safe database model for durable execution traceability, dedupe enforcement, and terminal failure handling.

## Inputs
- Output of 165a architecture contract
- `prisma/schema.prisma` (`BackgroundJob`, related enums/models)
- Existing queue runner semantics in `lib/background-jobs/runner.ts`
- Existing status persistence in `lib/inngest/job-status.ts`

## Work
- Decide minimal robust schema delta (no speculative over-modeling), likely including:
  - durable per-attempt run ledger for background jobs,
  - terminal/dead-letter visibility for unrecoverable failures,
  - dispatch-window/idempotency record for cron-to-Inngest send dedupe.
- Define constraints/indexes for high-volume operations:
  - unique keys for dedupe windows,
  - query indexes for pending/running/failed triage paths,
  - bounded retention strategy for historical run rows.
- Produce zero-downtime migration sequence:
  - additive schema first,
  - backfill/dual-write period,
  - cutover read paths,
  - cleanup/deprecation.
- Define rollback path and operator-safe fallbacks if migration/cutover regresses.

## Output
- Implemented additive reliability schema:
  - `BackgroundDispatchStatus` enum (`DISPATCHING`, `ENQUEUED`, `ENQUEUE_FAILED`, `INLINE_EMERGENCY`)
  - `BackgroundFunctionRunStatus` enum (`RUNNING`, `SUCCEEDED`, `FAILED`)
  - `BackgroundDispatchWindow` model:
    - unique `dispatchKey`
    - dispatch correlation + event IDs
    - status + failure message
    - indexed by status/window timestamps
  - `BackgroundFunctionRun` model:
    - unique `runKey`
    - function/run/attempt/dispatch correlation
    - durable timing + terminal error context
    - indexed for operator triage (`functionName`, `status`, `dispatchKey`, `runId`)
- Migration verification executed:
  - `npm run db:push` completed successfully against Supabase target.
- Reliability write path foundation added:
  - `lib/background-jobs/dispatch-ledger.ts` writes dispatch-window rows.
  - `lib/inngest/job-status.ts` dual-writes Redis status + durable `BackgroundFunctionRun`.

## Handoff
Use these schema contracts in 165c/165d to:
- enforce duplicate suppression at dispatch registration (`dispatchKey`),
- persist enqueued/failed/inline-emergency dispatch state,
- persist per-attempt run outcomes for process + maintenance functions.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Converted 165b from design-only to implemented additive schema + write-path wiring.
  - Applied migration and generated updated Prisma client.
  - Ensured schema changes are scoped to background orchestration reliability only.
- Commands run:
  - `npx prisma format` — pass.
  - `npx prisma generate` — pass.
  - `npm run db:push` — pass.
- Blockers:
  - None for schema rollout.
- Next concrete steps:
  - Complete dispatch cutover and run-mode semantics (165c).
  - Complete durable observability + validation evidence (165d/165e).
