# Phase 13a — Audit Analytics + Define Bar Chart Spec

## Focus
Identify the current data shape and chart implementation for “Response Sentiment”, then define a bar chart spec that remains readable as sentiment categories grow.

## Inputs
- Current UI: `components/dashboard/analytics-view.tsx` (“Response Sentiment” pie chart)
- Analytics data source: `actions/analytics-actions.ts` (`getAnalytics()` → `sentimentBreakdown`)
- Chart primitives: `components/ui/chart` (`ChartContainer`, `ChartTooltip`, etc.)
- Screenshot feedback: donut labels overlap and become unreadable with many categories

## Work
- Confirm the data fields available for each sentiment bucket (`sentiment`, `count`, `percentage`) and whether totals are all-time or date-ranged.
  - `getAnalytics()` returns `sentimentBreakdown: { sentiment, count, percentage }[]` and computes it over all leads in the selected scope (not date-ranged).
- Decide what the bar chart encodes:
  - Primary: `percentage` (0–100) to preserve the intent of the existing donut.
  - Secondary: show `count` in the tooltip (and optionally on the right-hand side as a compact label).
- Define a scaling strategy for many categories:
  - Sort descending by `count` (largest volume first).
  - Render top `N=10` sentiments and aggregate the remainder into “Other” (count + percentage derived from counts/total).
- Define label/axis behavior:
  - Use a horizontal bar chart (`layout="vertical"`) so category labels sit on the Y axis.
  - Truncate long sentiment names in-axis; show the full name in the tooltip.
- Confirm color strategy:
  - Use existing `SENTIMENT_COLORS` for canonical sentiments.
  - Provide a deterministic fallback color for unknown strings (hash → HSL) so many “unknown” buckets don’t become indistinguishable gray.

## Output
- “Response Sentiment” bar chart spec:
  - Chart type: Recharts `BarChart` with `layout="vertical"` (horizontal bars).
  - X-axis: `percentage` (0–100).
  - Y-axis: sentiment category (tick formatter truncates; tooltip shows full string).
  - Ordering: sort by `count` desc.
  - Scale: show top `10` categories + “Other” (aggregate remaining categories).
  - Tooltip: show sentiment name, `count`, and `percentage` (derived from counts/total for consistency).
  - Colors: `SENTIMENT_COLORS` for known keys; deterministic hash fallback for unknown; “Other” uses neutral gray.
- Code touch-points for 13b:
  - `components/dashboard/analytics-view.tsx`: replace the pie chart block + swap `recharts` imports to `BarChart`/`Bar` (+ optional `LabelList`/`Cell`).
  - `actions/analytics-actions.ts`: no changes needed (already provides `count` + `percentage`); treat as source-of-truth for sentiment buckets.
  - `components/ui/chart.tsx`: reuse `ChartContainer` + `ChartTooltip` styling (no changes expected).

## Handoff
Phase 13b:
- Implement the sentiment bar chart in `components/dashboard/analytics-view.tsx` per spec (top‑10 + “Other”, percent bars, tooltip shows count).
- Remove the pie/donut label rendering entirely (root cause of overlap).
