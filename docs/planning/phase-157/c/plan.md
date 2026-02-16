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

## Handoff
Proceed to Phase 157d to remove client-side latency contributors after backend reductions land.
