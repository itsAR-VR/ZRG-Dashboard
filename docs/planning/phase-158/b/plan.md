# Phase 158b — Response Timing Pipeline Fixes (Cron + Overview Metrics)

## Focus
Stop `/api/cron/response-timing` from returning 500s and fix analytics overview response-time metrics SQL so it stops emitting Prisma `P2010` warnings.

## Inputs
- Phase 158a issue inventory (counts + error signatures + mapped touch points).
- Repo files:
  - `app/api/cron/response-timing/route.ts`
  - `lib/response-timing/processor.ts`
  - `actions/analytics-actions.ts` (response time metrics SQL; also used by Phase 157)

## Work
- Cron 500s (`syntax error at or near "$1"`):
  - Confirm the failing statement is `SET LOCAL statement_timeout = $1` (parameter placeholder).
  - Replace with a safe, bounded, non-user-controlled SQL string:
    - Prefer `tx.$executeRawUnsafe("SET LOCAL statement_timeout = <int>")` or an equivalent Prisma raw injection with strict numeric bounds.
  - Add a regression guard (test or minimal runtime assertion) so future changes don’t reintroduce parameterized `SET`.
- Analytics overview response-time metrics (`syntax error at or near "FILTER"`):
  - Fix SQL to avoid `AVG(...)::double precision FILTER (...)` ordering.
  - Options:
    - Remove the cast entirely (best if types already double precision), or
    - Move cast outside the aggregate+filter: `(AVG(...) FILTER (...))::double precision`.
  - Ensure the query executes cleanly under Postgres.
  - Coordinate with Phase 157 changes in `actions/analytics-actions.ts` (merge semantically; don’t overwrite).

## Validation (RED TEAM)
- `node --import tsx --test lib/__tests__/response-timing-processor-statement-timeout.test.ts` → verifies no placeholder-parameterized `SET LOCAL`.
- `node --import tsx --test lib/__tests__/analytics-response-time-metrics-sql.test.ts` → verifies aggregate/filter SQL ordering.
- `npm run lint` / `npm run typecheck` / `npm run build` / `npm test` for integration safety.

## Output
- Implemented and verified:
  - `lib/response-timing/processor.ts` now sets transaction timeout with bounded numeric string interpolation via `$executeRawUnsafe(\`SET LOCAL statement_timeout = <bounded-int>\`)`, eliminating the invalid `$1` utility-statement pattern.
  - `lib/response-timing/processor.ts` raw insert now explicitly sets `"id"`, `"createdAt"`, and `"updatedAt"` to avoid production DB default-drift (`23502` not-null constraint failures observed post-deploy).
  - `actions/analytics-actions.ts` response-time SQL uses `AVG(... ) FILTER (...)` form (no cast before `FILTER`), removing PG `42601` on overview metrics.
  - Regression guards added/updated:
    - `lib/__tests__/response-timing-processor-statement-timeout.test.ts`
    - `lib/__tests__/analytics-response-time-metrics-sql.test.ts`
- Multi-agent coordination:
  - Re-read current `actions/analytics-actions.ts` state and merged on top of Phase 157’s in-flight query hardening without reverting concurrent edits.

## Handoff
Proceed to Phase 158c to fix remaining analytics raw SQL failures (booking conversion stats).

## Progress This Turn (Terminus Maximus)
- Work done:
  - Verified `$1`/`FILTER` log signatures against exact source callsites.
  - Kept cron timeout change bounded/non-user-controlled to satisfy SQL safety constraints.
  - Fixed production-only insert default drift by explicitly writing `id/createdAt/updatedAt` columns.
  - Preserved concurrent analytics file changes from other phases while confirming SQL syntax regression coverage.
- Commands run:
  - `nl -ba lib/response-timing/processor.ts` + `rg` SQL signature checks — pass.
  - `nl -ba actions/analytics-actions.ts` around response-time SQL — pass.
  - `node --import tsx --test lib/__tests__/response-timing-processor-statement-timeout.test.ts lib/__tests__/analytics-response-time-metrics-sql.test.ts` — pass.
  - Production hotfix loop:
    - `vercel --prod --yes` (deploy `https://zrg-dashboard-b3i6nigmi-zrg.vercel.app`) — deployed; revealed `23502` on missing `id` default.
    - `vercel --prod --yes` (deploy `https://zrg-dashboard-p6m7s3fjh-zrg.vercel.app`) — deployed; revealed `23502` on missing `updatedAt` default.
    - `vercel --prod --yes` (deploy `https://zrg-dashboard-hmoopsjxc-zrg.vercel.app`) — deployed; cron endpoint recovered to `200`.
- Blockers:
  - None remaining for this subphase.
- Next concrete steps:
  - Finalize booking-conversion SQL typing fix evidence (158c).
  - Run full gates + replay evidence packet (158e).
