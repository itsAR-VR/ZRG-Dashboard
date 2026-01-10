# Phase 13b — Implement Sentiment Bar Chart + Swap Into Analytics View

## Focus
Replace the “Response Sentiment” pie/donut chart with a readable bar chart implementation using the existing chart stack.

## Inputs
- Phase 13a bar chart spec
- `components/dashboard/analytics-view.tsx` current pie chart block
- `actions/analytics-actions.ts` `sentimentBreakdown` data fields (`count`, `percentage`)

## Work
- Implement a horizontal bar chart (Recharts) for sentiment breakdown:
  - Sorted descending
  - Tooltips showing `sentiment`, `count`, `%`
  - Handle many categories per the spec (top‑N + “Other”, or scroll)
- Ensure the chart remains legible:
  - Remove per-bar text labels that would collide
  - Keep axis ticks readable (truncate + tooltip as needed)
- Keep styling consistent with the dashboard (dark mode, spacing, borders).
- Replace the existing pie chart block in the Analytics page with the new bar chart.

## Output
- Replaced the “Response Sentiment” pie/donut chart with a horizontal bar chart:
  - `components/dashboard/analytics-view.tsx`
  - Top 10 sentiments by volume + “Other”
  - Bars encode `%` (0–100), tooltip shows both `count` and `%`
  - Y-axis labels truncate for readability; tooltip displays full sentiment string
  - Deterministic fallback color for unknown sentiment buckets (hash → HSL)
- Kept the rest of the Analytics page unchanged (weekly activity chart, tables, KPI cards).

## Handoff
Phase 13c:
- Polish layout/UX around the charts row (spacing, responsiveness).
- Make empty states consistent and ensure the new bar chart remains legible on smaller widths.
