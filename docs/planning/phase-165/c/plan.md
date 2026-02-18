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
- Dispatch-only cutover implemented in `app/api/cron/background-jobs/route.ts`:
  - default path is enqueue-first when Inngest event publishing is configured,
  - forced inline mode is explicit (`BACKGROUND_JOBS_FORCE_INLINE=true`),
  - enqueue failure returns `503` (`mode: "dispatch-failed"`) by default.
- Emergency fallback is explicit and gated:
  - `BACKGROUND_JOBS_INLINE_EMERGENCY_FALLBACK=true` enables temporary inline fallback on enqueue failure.
- Deterministic dispatch IDs/keys implemented:
  - windowed `dispatchKey` from `lib/background-jobs/dispatch.ts`,
  - deterministic Inngest event IDs (`bg-process:*`, `bg-maint:*`),
  - duplicate suppression via `BackgroundDispatchWindow.dispatchKey`.
- Event payload contract aligned for observability/idempotency:
  - `source`, `requestedAt`, `dispatchKey`, `correlationId`, `dispatchWindowStart`, `dispatchWindowSeconds`.
- Inngest function-level controls hardened:
  - `idempotency: "event.data.dispatchKey"` on both background functions,
  - existing single-run concurrency preserved (`concurrency.limit = 1`).

## Handoff
Harden durable run observability + terminal semantics in 165d and close validation/canary evidence in 165e.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented dispatch control-plane and deterministic event identifiers.
  - Removed implicit steady-state inline fallback behavior.
  - Added operator-facing runtime mode signals in cron responses.
- Commands run:
  - `node --import tsx --test lib/__tests__/background-dispatch.test.ts` — pass.
  - `node --import tsx --test lib/__tests__/background-jobs-cron-no-advisory-lock.test.ts` — pass.
- Blockers:
  - None for dispatch cutover implementation.
- Next concrete steps:
  - Finalize run-status durability and terminal semantics (165d).
  - Complete full validation packet and rollout notes (165e).
