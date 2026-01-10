# Phase 14c — Improve chart rendering (labels, sizing, copy)

## Focus
Make the “Response Sentiment” bar chart readable: show all sentiment names, remove misleading copy, and format % labels sensibly.

## Inputs
- Phase 14b backend output (`sentimentBreakdown`)
- `components/dashboard/analytics-view.tsx`

## Work
- Update chart copy to reflect “% of responses”.
- Render all sentiment categories returned (no top‑N/“Other” grouping).
- Ensure all Y-axis labels render:
  - Set `interval={0}` on the categorical axis.
  - Increase chart height based on number of sentiments so ticks don’t overlap.
  - Increase Y-axis label width and truncation threshold so names are visible.
- Keep tooltip showing `count` and `%`.

## Output
- Updated `components/dashboard/analytics-view.tsx` with a correct, readable chart.

## Handoff
Run `npm run lint` + `npm run build` and visually confirm the chart matches expectations.

