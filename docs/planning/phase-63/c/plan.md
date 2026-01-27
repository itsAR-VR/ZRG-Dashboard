# Phase 63c — Analytics: Relational Scoping + SQL Response Times

## Focus
Eliminate large `clientIds` arrays from analytics queries and move response-time metrics to SQL to avoid large data loads and Prisma driver failures.

## Inputs
- `actions/analytics-actions.ts`
- `lib/workspace-access.ts`

## Work
- [ ] Introduce relational “accessible client/lead” where filters (no `IN (...)` arrays).
- [ ] Update analytics queries to use relational scoping.
- [ ] Implement SQL window-function aggregation for response time metrics and per-setter response times.

## Output
- Added `lib/workspace-access-filters.ts` providing relational Prisma `where` filters for accessible Clients/Leads (no `IN (...)` arrays).
- Refactored `actions/analytics-actions.ts`:
  - User-scoped analytics cache keys (`${userId}:${clientId|__all__}`) to prevent cross-user cache leakage.
  - Authorization check happens before cache read.
  - Removed `resolveClientScope()`/`scope.clientIds` usage.
  - Response time metrics and per-setter response times now use SQL window functions (no large nested lead/message loads).
  - Top clients now computed via grouped Lead counts instead of fetching/sorting all clients in JS.

## Handoff
Proceed to Phase 63d to fix global phone normalization (including optional AI assistance), downgrade expected GHL 4xx logs, and normalize GHL appointment list responses to fix reconcile cron failures.
