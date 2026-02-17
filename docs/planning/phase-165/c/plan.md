# Phase 165c — Cron Dispatch Cutover + Inngest Orchestration Refactor

## Focus
Replace hybrid execution with strict dispatch semantics and deterministic orchestration controls.

## Inputs
- 165a architecture contract
- 165b schema plan
- `app/api/cron/background-jobs/route.ts`
- `lib/inngest/events.ts`
- `lib/inngest/functions/process-background-jobs.ts`
- `lib/inngest/functions/background-maintenance.ts`

## Work
- Refactor cron route to dispatch-only by default:
  - remove heavy inline fallback as normal behavior,
  - retain explicit emergency override flag for temporary operational recovery.
- Introduce deterministic dispatch IDs/keys per schedule window to prevent duplicate enqueue bursts.
- Align event payload contract for observability and idempotency (`source`, `requestedAt`, dispatch key, correlation id).
- Apply Inngest function controls from 165a:
  - concurrency limits (and keys/scope where needed),
  - debounce/rate-limit for burst collapse if required.
- Ensure response contract from cron remains explicit and operator-friendly (mode, enqueued status, correlation metadata).

## Output
- Inngest-first dispatch flow in place, with duplicate-resistant event publishing and explicit runtime modes.

## Handoff
Harden execution semantics and observability in 165d.
