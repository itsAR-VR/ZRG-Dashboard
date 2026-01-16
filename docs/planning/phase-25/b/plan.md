# Phase 25b — Fix Scroll + Responsiveness

## Focus
Apply minimal structural/layout fixes so the UI scrolls correctly and the controls never clip off-screen.

## Inputs
- Findings from Phase 25a (where `min-h-0` / `min-w-0` and shrink overrides are needed).

## Work
- Fix the page wrapper so the console can own scrolling:
  - Update `components/dashboard/insights-view.tsx` to use `overflow-hidden` + `min-h-0` (prevents “double scroll” and allows inner ScrollAreas to work).
- Apply `min-h-0` constraints at all ScrollArea boundaries:
  - Update `components/dashboard/insights-chat-sheet.tsx`:
    - root container: `flex h-full min-h-0 flex-col`
    - sessions sidebar: `flex min-h-0 flex-col ...`
    - sessions `ScrollArea`: `className="flex-1 min-h-0"`
    - main pane: `flex min-h-0 min-w-0 flex-col ...`
    - messages `ScrollArea`: `className="flex-1 min-h-0"`
- Prevent right-side clipping and make actions resilient:
  - Add `min-w-0` to the controls row/grid container.
  - Campaign scope button: add `min-w-0 overflow-hidden`, label `min-w-0 truncate`.
  - Defaults action cluster:
    - switch to column on small widths and row at `sm`
    - action buttons get `min-w-0 overflow-hidden` and `truncate` labels so they can shrink without clipping.
- Validate:
  - `npm run lint` (no new errors; warnings pre-existing)
  - `npm run build` (success)

## Output
- Implemented a layout-safe fix for the Insights Console scroll + clipped controls:
  - Sessions list and messages list are now in ScrollAreas that can actually scroll (proper `min-h-0` constraints applied).
  - “Recompute” and “Regenerate” no longer get clipped off the right side under typical widths (responsive stacking + `min-w-0` truncation).
- Repo validation:
  - `npm run lint` passes with existing warnings.
  - `npm run build` succeeds.

## Handoff
Proceed to Phase 25c: add any remaining ChatGPT-like polish (readability, spacing, message rendering) without changing Insights Console behavior/APIs.
