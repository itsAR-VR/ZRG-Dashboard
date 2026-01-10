# Phase 13c — Analytics Page Polish (UX + Responsiveness)

## Focus
Improve overall Analytics page readability and UX, especially for large workspaces (many leads/messages), without changing core metrics definitions.

## Inputs
- Phase 13b implementation (new sentiment bar chart)
- Current Analytics layout: `components/dashboard/analytics-view.tsx`
- Existing UI primitives: Cards, Tables, Select, ChartContainer

## Work
- Chart UX improvements:
  - Ensure consistent chart heights in the “Charts Row”
  - Make chart containers responsive (avoid clipping/overflow on smaller widths)
  - Improve “No … data available” states to be consistent and helpful
- Page layout polish:
  - Tighten spacing and typography for better scanability
  - Ensure KPI cards don’t overflow and remain readable across breakpoints
- Optional (only if small and safe):
  - Wire the “Last 7 days / 30d / 90d” period select into the data fetch if the backend can support it cleanly (otherwise remove/disable the control to avoid a misleading UI).

## Output
- Polished Analytics page UX in `components/dashboard/analytics-view.tsx`:
  - Clarified the sentiment chart description (“Top sentiments… grouped as Other”).
  - Standardized chart container sizing (`aspect-auto`) to reduce layout quirks.
  - Disabled the (previously non-functional) time range dropdown with a “coming soon” hint to avoid misleading controls.

## Handoff
Phase 13d validates with “worst-case” datasets and runs lint/build checks.
