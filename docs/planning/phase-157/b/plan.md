# Phase 157b — CRM Summary Stability Hardening (Raw SQL Bind Safety)

## Focus
Remove brittle raw-query patterns that can produce type-inference failures in production and lock CRM summary stability.

## Inputs
- `actions/analytics-actions.ts` (`getCrmWindowSummary`)
- Jam failure payload from Phase 157a
- Route wrapper: `app/api/analytics/crm/rows/route.ts`

## Work
1. Audit `getCrmWindowSummary` raw SQL for nullable bind usage in predicates (`IS NULL OR ... = $param` style).
2. Replace ambiguous bind patterns with typed SQL fragments / branch predicates.
3. Add regression-oriented coverage for CRM summary path with/without `responseMode`, with/without date window.
4. Ensure failure payloads remain structured and debuggable (`x-request-id` preserved from route layer).
5. Verify no equivalent nullable-bind anti-patterns remain in analytics raw queries.

## Validation (RED TEAM)
- `npm run typecheck`
- `npm run build`
- Targeted CRM summary manual/API checks return `200` for previously failing query shapes.

## Output
- CRM summary path is stable under optional filters.
- Raw SQL bind safety pattern documented for reuse in analytics queries.

## Progress
- 2026-02-16 — Implemented nullable-bind hardening in `getCrmWindowSummary` (`actions/analytics-actions.ts`):
  - Replaced ambiguous `(${param} IS NULL OR ...)` raw SQL predicates with typed SQL branches (`responseModePredicateSql`, `bookedInWindowAnySql`, `bookedInWindowKeptSql`).
  - Eliminated the `42P18` parameter-type ambiguity path observed in production CRM summary requests.
- 2026-02-16 — Validation: `npm run typecheck` ✅, `npm run build` ✅, `npm test` ✅.

## Handoff
Proceed to Phase 157c to reduce query time now that stability regressions are removed.
