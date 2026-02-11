# Phase 131a — Wire Analytics Window Into CRM Tab

## Focus
Fix the broken custom date behavior by making the Analytics window parameters drive the CRM tab queries (and making the applied window visible so users trust what they are seeing).

## Inputs
- Phase 131 root context and window definitions.
- Existing Analytics window computation in `components/dashboard/analytics-view.tsx` (`windowParams`).
- Existing CRM filters in `actions/analytics-actions.ts` (`CrmSheetFilters.dateFrom/dateTo`) and filtering in `getCrmSheetRows()`.

## Work
1. Update `components/dashboard/analytics-view.tsx`:
   - Pass `windowParams` (or the underlying `windowRange`) into the CRM tab component (`AnalyticsCrmTable`).
2. Update `components/dashboard/analytics-crm-table.tsx`:
   - Accept `window` props (e.g. `{ from: string; to: string } | undefined`) and merge into `filters.dateFrom/dateTo` for all fetches:
     - initial load effect
     - refresh
     - load-more pagination
   - Add a small “Applied window: <label>” indicator (use the Analytics-provided label so it matches the dropdown).
3. Ensure no ambiguous double-windowing:
   - Do not add a separate CRM-local date picker; the source of truth is the Analytics window control.

## Output
- Selecting a custom date range in Analytics changes the CRM tab results without additional user actions.
- CRM tab visibly shows the applied window.

## Validation (RED TEAM)

- After wiring, verify: selecting "Custom range" with dates in `analytics-view.tsx` causes `getCrmSheetRows()` to receive non-null `filters.dateFrom`/`filters.dateTo` (add a temporary `console.log` or inspect network payload).
- Verify: changing the date range re-triggers the CRM table fetch (initial load effect + refresh all respond to window changes).
- Verify: load-more pagination preserves the window (does not reset to "all time").
- Document the `dateTo` convention with a code comment: analytics-view adds +1 day to make UI end-date inclusive; `getCrmSheetRows()` uses `lte` on the already-adjusted value.

## Handoff
- Phase 131b can assume `filters.dateFrom/dateTo` are consistently applied, and can safely build response-type analytics scoped to that window.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Wired the Analytics window into the CRM tab so CRM rows and summary metrics are scoped to the selected date preset/custom range.
  - Added a visible window indicator in the CRM tab (to make the applied window obvious at a glance).
- Commands run:
  - See Phase 131e (quality gates)
- Blockers:
  - None
- Next concrete steps:
  - None (handoff complete)
