# Phase 13 — Analytics Chart Readability (Sentiment Bar Chart + Page Polish)

## Purpose
Replace the cluttered “Response Sentiment” pie/donut chart with a scalable bar chart and improve the Analytics page readability for high-volume workspaces.

## Context
The current “Response Sentiment” visualization uses a pie/donut chart with per-slice labels. Once there are many sentiment categories (or many small categories), labels collide and become unreadable (as seen in the screenshot). Workspaces with more leads look worse. A sorted bar chart (optionally with top‑N + “Other”) will scale without label overlap.

## Objectives
* [x] Confirm where sentiment breakdown data is computed and how many categories we can expect
* [x] Define a bar chart spec that remains readable with 20+ categories
* [x] Replace the pie chart with a horizontal bar chart (counts + %), with tooltips and sensible ordering
* [x] Polish the Analytics page layout/spacing and “no data” handling to look good across account sizes
* [x] Validate with large datasets and run `npm run lint` + `npm run build`

## Constraints
- Prefer the existing chart stack already in use (`recharts` + `ChartContainer`).
- Avoid adding new dependencies unless there is a clear gap.
- Keep the UI responsive (desktop + smaller widths) and accessible (no information only conveyed by color).
- Do not change analytics definitions/meaning; this is primarily a visualization + UX improvement.

## Success Criteria
- [x] “Response Sentiment” is rendered as a bar chart (not a pie/donut) and stays readable with many categories.
- [x] No overlapping/stacked labels; long category names are still readable (wrap/truncate + tooltip).
- [x] Bars are sorted (highest first) and show both `count` and `%` (either via labels or tooltip).
- [x] Analytics page looks clean on large workspaces (e.g., 10k+ leads) and small workspaces (empty states remain helpful).
- [x] No console errors; `npm run lint` and `npm run build` pass.

## Subphase Index
* a — Audit current analytics + define bar chart spec (top‑N, “Other”, labels)
* b — Implement sentiment bar chart (Recharts) and swap it into Analytics view
* c — Analytics page polish (layout/responsive, chart UX details, better empty states)
* d — QA/regression (large-category test data, visual checks, lint/build)

## Phase Summary
- Replaced the unreadable sentiment pie/donut with a horizontal bar chart (top 10 + “Other”), including a tooltip that shows both count and %: `components/dashboard/analytics-view.tsx`.
- Added deterministic fallback colors for unknown sentiment buckets and truncation for long axis labels to keep the chart readable at high category counts.
- Standardized chart container sizing (`aspect-auto`) and disabled the non-functional time range dropdown with a “coming soon” hint to avoid misleading UI.
- Validation: `npm run lint` (warnings only) and `npm run build` succeeded.
