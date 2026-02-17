# Phase 165a — Architecture + Inngest Spec Cross-Verification

## Focus
Define the replacement architecture and lock non-negotiable reliability rules before code changes, using Context7 and available Inngest MCP docs for double-checking concurrency/retry/idempotency assumptions.

## Inputs
- `docs/planning/phase-165/plan.md`
- `app/api/cron/background-jobs/route.ts`
- `lib/inngest/client.ts`
- `lib/inngest/functions/process-background-jobs.ts`
- `lib/inngest/functions/background-maintenance.ts`
- `lib/background-jobs/runner.ts`
- Context7 Inngest references + available Inngest MCP documentation paths (if exposed)

## Work
- Document the as-is flow (cron dispatch, enqueue, fallback, runner, retries, lock behavior).
- Confirm Inngest config semantics for:
  - retries,
  - concurrency keys/limits,
  - debounce/rate-limit options,
  - event idempotency strategy (`event.id` / dispatch key).
- Define target architecture contract:
  - cron = authenticated dispatcher only,
  - Inngest = execution authority,
  - inline execution = emergency-only kill switch.
- Define SLOs + stop-gates:
  - dispatch latency budget,
  - duplicate-run tolerance (target zero),
  - backlog/lag thresholds.

## Output
- A locked architecture contract and control-plane policy for Phase 165 implementation (including explicit defaults and kill switches).

## Handoff
Use the architecture contract to design the schema and migration strategy in 165b.
