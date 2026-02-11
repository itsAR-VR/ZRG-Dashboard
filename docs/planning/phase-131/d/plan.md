# Phase 131d — CRM Analytics Summary UI + Filters + Table Tweaks

## Focus
Make the CRM tab useful at a glance while preserving the sheet-like table: show KPIs + breakdowns for the selected window, and make response type and setter/AI attribution easy to see.

## Inputs
- Window wiring from Phase 131a.
- Response-type derivation from Phase 131b.
- Summary aggregates action from Phase 131c.
- Existing CRM table filters (`campaign`, `leadCategory`, `leadStatus`, `responseMode`).

## Work
1. Add summary panel above the table in `components/dashboard/analytics-crm-table.tsx`:
   - KPI strip: Cohort leads, Booked ever, Cohort conversion, Booked in-window, In-window rate.
   - Breakdown tables:
     - Response Type
     - AI vs Human
     - Top setters (+ AI row)
   - Include clear loading, empty, and error states.
2. Add response-type column and filter:
   - Add a “Response Type” column near Lead Category / Response Mode (not at the far right).
   - Add a filter control (optional if we want to keep v1 minimal; default is “All”).
3. Clarify labels and reduce ambiguity:
   - Rename `DATE` header to `Interest date` (ties to `interestRegisteredAt`).
   - Keep “AI vs Human Response” near setter-related fields.

## Output
- Analytics → CRM shows both a quick summary and a detailed table, consistently scoped to the selected window and filters.

## Validation (RED TEAM)

- Verify: summary panel KPIs match the numbers returned by `getCrmWindowSummary()` (inspect network or console).
- Verify: changing the date range updates both the summary panel AND the table (no stale data).
- Verify: response-type column values match `deriveCrmResponseType()` output for each row.
- Verify: loading/empty/error states render correctly (test with: no window selected, empty window, server error).
- Verify: response-type filter (if added) correctly narrows both the table rows and refreshes summary.

## Handoff
- Phase 131e adds tests and runs quality gates for confidence before shipping.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added CRM tab KPI strip + breakdown tables for the selected window (response type, AI vs human, top setters).
  - Added a “Response Type” column in the CRM table for first-glance scanning.
- Commands run:
  - See Phase 131e (quality gates)
- Blockers:
  - None
- Next concrete steps:
  - None (handoff complete)
