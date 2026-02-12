# Phase 144c Wave 2 Delta

## Scope Executed
Applied a low-risk chunk deferral on Insights view while avoiding high-conflict files.

## Changes Applied
- `components/dashboard/insights-view.tsx`
  - Replaced synchronous imports with dynamic imports for:
    - `InsightsConsole`
    - `MessagePerformancePanel`
  - Added lightweight loading fallbacks for both.

Anchors:
- `components/dashboard/insights-view.tsx:5`
- `components/dashboard/insights-view.tsx:10`

## Impact Notes
- This optimization defers Insights-specific heavy dependencies until Insights is opened.
- As expected, this does **not** materially reduce default inbox-route `rootMainFiles` payload, since Insights is already a non-default lazy path.

## What Was Deferred
- `@next/bundle-analyzer` setup and treemap attribution (not yet installed/configured).
- Analytics tab-internal splitting in `components/dashboard/analytics-view.tsx` (still pending).
- Settings tab-panel sub-splitting (deferred due ongoing cross-phase churn in `settings-view.tsx`).

## Additional Wave-2 Pass (This Turn)
- `components/dashboard/analytics-view.tsx` now dynamically loads:
  - `AnalyticsCrmTable`
  - `BookingProcessAnalytics`
- Validation:
  - `npm run lint` -> pass (warnings only)
  - `npm run build` -> pass
- Payload check after this pass:
  - `rootMainFiles` remains `122,932` gzip bytes (no change on default route), which confirms this optimization is route-local and not sufficient for root target.
