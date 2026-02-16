# Phase 157c — Backend Query Optimization + Index Plan

## Focus
Lower server compute time for analytics endpoints by rewriting heavy aggregation paths and adding targeted indexes where justified.

## Inputs
- Baseline p95 packet from 157a
- Stabilized query layer from 157b
- `actions/analytics-actions.ts`
- `actions/response-timing-analytics-actions.ts`
- `prisma/schema.prisma`

## Work
1. Optimize `getEmailCampaignAnalytics`:
   - Replace wide `lead.findMany + JS aggregation` with SQL-side aggregation where possible.
   - Keep output contract unchanged.
2. Optimize `getAnalytics` core path:
   - Reduce multiple round-trips where a consolidated CTE/query can compute KPI totals.
3. Review `getResponseTimingAnalytics` and `getCrmWindowSummary` query plans for avoidable scans.
4. Propose and apply targeted indexes only if plans/latency justify them.
   - Decision lock: production index changes are allowed in this phase, but only via canary rollout with explicit rollback notes.
5. If indexes are added, include safe schema update + verification.

## Validation (RED TEAM)
- Compare before/after p95 on optimized endpoints.
- Ensure route response shape compatibility (no client breakage).
- If schema changed:
  - `npm run db:push`
  - Verify index presence and endpoint health.

## Output
- Reduced backend p95 for top offenders with measured deltas.
- Index change log (if any) with rollback notes.

## Progress
- 2026-02-16 — Implemented SQL-side aggregation rewrite for `getEmailCampaignAnalytics` in `actions/analytics-actions.ts`:
  - Replaced `lead.findMany` + per-lead JS loop aggregation with transaction-scoped aggregate queries for campaign KPIs, sentiment, industry, and headcount.
  - Preserved existing response contract shape (`campaigns`, `weeklyReport`, rates and sorting semantics).
  - Added `SET LOCAL statement_timeout = 15000` around aggregate query transaction for predictable query budget.
- 2026-02-16 — No schema/index changes were required for this step.
- 2026-02-16 — Validation for this step: `npm run typecheck` ✅, `npm run build` ✅, `npm test` ✅.
- 2026-02-16 — Additional backend latency pass in `actions/analytics-actions.ts`:
  - Added transaction-local timeout guard to per-setter response-time SQL (`SET LOCAL statement_timeout = 5000`) to fail fast instead of stalling overview breakdown payloads.
  - Parallelized independent breakdown reads in `getAnalytics` (responses count, total leads count, sentiment/status group-bys, weekly message stats, top-client aggregates, per-setter response times) to reduce sequential round-trip latency.
  - Kept API contract unchanged.
- 2026-02-16 — Validation for this additional step: `npx eslint actions/analytics-actions.ts` ✅, `npm run typecheck` ✅, `npm run lint` ✅ (warnings-only), `npm run build` ✅, `npm test` ✅.
- 2026-02-16 — Response timing analytics backend hardening:
  - Reproduced production `500` in `/api/analytics/response-timing` and tied it to Prisma/Postgres typing error (`P2010` / `42883`).
  - Updated `actions/response-timing-analytics-actions.ts` to explicitly type SQL date window and interval arithmetic params (`::timestamp`, `::int`) to prevent `timestamp >= interval` operator failures.
  - Added regression guard `lib/__tests__/response-timing-analytics-sql-typing.test.ts`.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Executed a surgical analytics backend optimization on `getAnalytics` breakdown path for lower end-to-end latency on cold loads.
  - Added defensive timeout control on per-setter response metric query to avoid long-tail stalls.
  - Revalidated full quality gate suite on current tree.
- Commands run:
  - `npx eslint actions/analytics-actions.ts` — pass.
  - `npm run typecheck` — pass.
  - `npm run lint` — pass (warnings only, pre-existing).
  - `npm run build` — pass.
  - `npm test` — pass (387/387).
- Blockers:
  - None for code-level optimization scope.
- Next concrete steps:
  - Capture authenticated canary packet (157f) to quantify before/after p95 deltas for these query-shape changes.

## Handoff
Proceed to Phase 157d to remove client-side latency contributors after backend reductions land.
