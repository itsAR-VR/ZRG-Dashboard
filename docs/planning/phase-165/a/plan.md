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

## Architecture Contract (Locked)
- Dispatch authority:
  - `/api/cron/background-jobs` is dispatch-only by default when Inngest event publishing is configured.
  - Inline execution is not a normal fallback path; it is an explicit emergency mode only.
- Dispatch idempotency:
  - Every cron tick computes a deterministic `dispatchKey` from a fixed time window.
  - Each Inngest event uses deterministic producer-side `id` derived from the `dispatchKey`.
  - Duplicate ticks in the same window must not create duplicate durable executions.
- Execution authority:
  - Inngest functions own background execution; cron does not run heavy background processing in steady state.
  - Functions enforce serial execution per function (`concurrency.limit = 1`) and function-level idempotency using the same dispatch key.
- Failure policy:
  - Enqueue failure returns an explicit non-success response by default (`dispatch-failed`) with correlation metadata.
  - Optional emergency inline fallback is guarded by dedicated env kill switch and must be time-bounded during incidents.
- Observability contract:
  - Event payload contract includes `source`, `requestedAt`, `dispatchKey`, `correlationId`, `dispatchWindowStart`, `dispatchWindowSeconds`.
  - Durable status records are required for dispatch windows and function run attempts.
- SLO / stop-gates:
  - Cron dispatch response target: p95 under 2s.
  - Duplicate durable run target per dispatch window: zero.
  - Stop rollout if enqueue failures, duplicate execution, or queue lag growth crosses thresholds.

## Inngest Spec Verification (Context7 + Inngest MCP)
- Producer-side event `id` prevents duplicate triggering for 24 hours (Inngest idempotency guide + send reference).
- Function-level `idempotency` also provides 24-hour duplicate suppression (equivalent to `rateLimit` key/limit-1/24hr).
- `concurrency`, `throttle`, `debounce`, and `retries` are valid `createFunction` controls; this phase uses `concurrency` + `idempotency` as load-bearing controls.
- Event idempotency caveat: debouncing/batching semantics can bypass strict event-id behavior in specific modes; this plan avoids those modes for background dispatch.

## Output
- Locked contract finalized with deterministic dispatch keys, producer event-id dedupe, explicit emergency-only inline policy, and function-level idempotency/concurrency controls.

## Handoff
Use this contract in 165b/165c to implement:
- durable dispatch/run ledgers in Prisma,
- dispatch-only cron cutover with deterministic dispatch IDs,
- emergency-inline kill switch behavior with explicit status signaling.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Re-read current cron + Inngest function implementation and confirmed inline fallback remains in steady-state path.
  - Cross-verified Inngest idempotency/concurrency semantics via Context7 and Inngest MCP docs.
  - Locked a concrete control-plane contract to remove ambiguity before implementation.
- Commands run:
  - `sed -n '1,260p' app/api/cron/background-jobs/route.ts` — pass.
  - `sed -n '1,260p' lib/inngest/functions/process-background-jobs.ts` — pass.
  - `sed -n '1,260p' lib/inngest/functions/background-maintenance.ts` — pass.
  - `mcp__context7__resolve-library-id (inngest)` — pass.
  - `mcp__context7__query-docs` (idempotency/concurrency/retries/debounce) — pass.
  - `mcp__inngest-dev__read_doc` (`guides/handling-idempotency.mdx`, `reference/events/send.mdx`, `reference/functions/create.mdx`) — pass.
- Blockers:
  - None for architecture lock.
- Next concrete steps:
  - Implement dispatch-only cron behavior with deterministic dispatch IDs.
  - Add durable dispatch/run traceability schema and write paths.
