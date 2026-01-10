# Phase 14a — Audit current aggregation + define target behavior

## Focus
Confirm how “Response Sentiment” is computed today (denominator + included categories) and define the desired calculation and UI behavior.

## Inputs
- User screenshots of the Analytics page and “Response Sentiment” chart
- `actions/analytics-actions.ts` (`getAnalytics()`)
- `components/dashboard/analytics-view.tsx` (chart rendering)
- `lib/sentiment-shared.ts` (sentiment tags, meaning of “New”)

## Work
- Locate where `sentimentBreakdown` is computed and how the chart uses it.
- Verify which entities are being counted (all leads vs responded leads).
- Define the response denominator: `overview.responses` (unique leads with inbound messages).
- Define category rules:
  - Exclude “New” from response sentiment (or map to “Unknown” if present on responded leads).
  - Show all sentiment types present in responses (no top‑N truncation).
- Define label visibility rules (no tick skipping; enough space for labels).

## Output
- A clear spec for aggregation + rendering that can be implemented in Phase 14b/14c.

## Handoff
Proceed to Phase 14b to update `getAnalytics()` aggregation to compute response-based sentiment breakdown.

