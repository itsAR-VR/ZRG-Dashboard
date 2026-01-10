# Phase 14b — Implement responses-based sentiment aggregation (server)

## Focus
Update `getAnalytics()` to compute `sentimentBreakdown` over responded leads and calculate percentages as a fraction of total responses.

## Inputs
- Phase 14a spec
- `actions/analytics-actions.ts`

## Work
- Compute the response population as leads with at least one inbound message (same definition as `overview.responses`).
- Group responded leads by `sentimentTag` and count them.
- Normalize sentiment values:
  - Treat `null` and `New` as “Unknown” for response sentiment purposes.
- Compute percentages as `count / responses * 100` (keep precision for UI formatting).

## Output
- Updated `actions/analytics-actions.ts` returning a correct `sentimentBreakdown`.

## Handoff
Proceed to Phase 14c to update the chart UI to display all labels and use response-based percentages.

