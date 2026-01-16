# Phase 25a — Diagnose Layout + Overflow Root Causes

## Focus
Reproduce the scroll/clipping issues and identify the exact layout constraints (flex/grid/overflow) causing them.

## Inputs
- Jam report for Insights Console UX regression (scroll broken, right-side clipped, Regenerate missing).
- Current Insights Console components:
  - `components/dashboard/insights-view.tsx`
  - `components/dashboard/insights-chat-sheet.tsx`

## Work
- Validate repro context:
  - Jam MCP is not available in this environment (`Auth required`), so diagnosis is performed via code inspection + known Radix ScrollArea/flexbox behavior.
  - Insights Console renders via `components/dashboard/insights-view.tsx` (page) and can also render inside a Sheet (`InsightsChatSheet`), so fixes must be layout-safe for both.
- Inspect `components/dashboard/insights-chat-sheet.tsx` layout:
  - Root is a column flex container with a header and a `grid flex-1 ... overflow-hidden` body.
  - Sessions + messages lists are Radix `ScrollArea` instances nested inside flex/grid parents.
- Identify the failure modes:
  - **Scroll broken**: One or more parent flex/grid containers are missing `min-h-0`, so the ScrollArea root/viewport never receives a constrained height → viewport expands and the page ends up non-scrollable/clipped.
  - **Right-side clipped**: Main pane/control grid missing `min-w-0` + Buttons default to `shrink-0 whitespace-nowrap` (`components/ui/button.tsx`) → control row overflows horizontally, then gets clipped by `overflow-hidden` parents.
  - **Regenerate missing**: A symptom of the above horizontal overflow/clipping in the “Defaults” control cluster.
- Document minimal fixes to implement (Phase 25b):
  - Add `min-h-0` to the relevant flex parents and to ScrollArea roots (`className="flex-1 min-h-0"`).
  - Add `min-w-0` to the main pane + controls grid; apply `overflow-hidden` + `truncate` to labels.
  - Make the “Defaults” action buttons responsive (stack on narrow widths) so they never overflow off-screen.

## Output
- Root causes identified:
  - Missing `min-h-0` in nested flex/grid prevented Radix `ScrollArea` from scrolling.
  - Missing `min-w-0` + default `Button` styles (`shrink-0 whitespace-nowrap`) caused horizontal overflow; `overflow-hidden` clipped controls, hiding “Regenerate”.
- Fix strategy confirmed:
  - Apply `min-h-0`/`min-w-0` constraints at the correct container boundaries (not by removing `overflow-hidden` everywhere).
  - Override/structure action controls so they can shrink/wrap without breaking layout.

## Handoff
Proceed to Phase 25b: implement the `min-h-0`/`min-w-0` and control responsiveness changes in `components/dashboard/insights-view.tsx` and `components/dashboard/insights-chat-sheet.tsx`, then validate scroll + control visibility.
