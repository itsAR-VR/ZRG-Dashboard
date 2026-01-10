# Phase 14 — Response Sentiment chart (responses-based + readable labels)

## Purpose
Fix the Analytics “Response Sentiment” chart so it reflects the % breakdown of *responses* (responding leads) rather than % of all leads, and ensure all sentiment names are readable.

## Context
The current chart is calculated against total leads and includes non-response states (e.g. “New”), which makes sentiment percentages look artificially tiny and misleading. Additionally, the bar chart’s Y-axis is skipping labels, so only every other sentiment name appears.

## Objectives
* [x] Identify the current sentiment breakdown source and why it’s miscomputed
* [x] Update backend aggregation to compute sentiment breakdown over responses
* [x] Update the chart UI to show all sentiment names and correct percentages

## Constraints
- Use existing analytics data flow (`actions/analytics-actions.ts` → `components/dashboard/analytics-view.tsx`).
- Do not commit secrets or personal data.
- Keep UI readable when many sentiment categories are present.

## Success Criteria
* [x] “Response Sentiment” percentages are calculated as `count / totalResponses` (not `count / totalLeads`).
* [x] “New” (no inbound replies yet) is not displayed as a response sentiment; it is excluded or rolled into “Unknown” for responded leads.
* [x] All sentiments with non-zero counts render with visible names (no skipped labels).
* [x] Tooltip shows both count and % for each sentiment.

## Subphase Index
* a — Audit current aggregation + define target behavior
* b — Implement responses-based sentiment aggregation (server)
* c — Improve chart rendering (labels, sizing, copy)

## Phase Summary
- Root cause: sentiment breakdown was computed over all leads (and could include non-response states like “New”), making response sentiment % misleading.
- Server fix: `getAnalytics()` now computes `sentimentBreakdown` over responded leads only and calculates `percentage = count / responses * 100`, with `null`/`New` normalized to `Unknown` (`actions/analytics-actions.ts`).
- UI fix: chart now renders all sentiment categories, forces all labels to render (`interval={0}`), widens/truncates labels more generously, and auto-expands chart height based on number of categories (`components/dashboard/analytics-view.tsx`).
- Validation: `npm run lint` (warnings only) and `npm run build` succeeded.
