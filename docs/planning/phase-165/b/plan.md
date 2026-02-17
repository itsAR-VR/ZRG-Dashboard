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
- Approved schema change set + migration/backfill/rollback playbook ready for implementation.

## Handoff
Implement cron dispatch cutover and Inngest orchestration changes in 165c using the finalized schema contracts.
