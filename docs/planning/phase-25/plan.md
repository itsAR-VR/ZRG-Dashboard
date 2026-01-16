# Phase 25 — Insights Console UI Polish (Scroll + Layout)

## Purpose
Fix the Insights Console UX so it’s reliably usable: chat + sessions scroll correctly, controls don’t clip off-screen (incl. Regenerate), and the layout feels closer to ChatGPT.

## Context
The Insights Console UI has reported issues where the chat area won’t scroll, the right side of the toolbar gets cut off, and key actions (e.g. Regenerate) disappear. These symptoms typically come from nested flex/grid containers missing `min-h-0` / `min-w-0`, plus buttons that can’t shrink (`shrink-0` + `whitespace-nowrap`) forcing horizontal overflow that gets clipped by `overflow-hidden`.

## Objectives
* [x] Identify the exact layout constraints causing scroll + clipping issues
* [x] Fix scroll behavior for sessions + messages in all layouts (page + sheet)
* [x] Make the header/controls responsive so actions never disappear
* [x] Improve message formatting + visual polish toward a ChatGPT-like feel

## Constraints
- Keep the Insights Console behavior and APIs unchanged (UI-only unless required for UX correctness).
- Use existing components/styles (Tailwind + shadcn/ui) without introducing new heavy dependencies.
- Ensure the UI works both embedded on the Insights page and inside the optional Sheet view.
- Preserve accessibility (focus rings, keyboard navigation, readable contrast).

## Success Criteria
- [x] Sessions list scrolls when long; message area scrolls when long; composer stays usable.
- [x] No horizontal clipping of controls at typical breakpoints (Regenerate always visible).
- [x] Sessions preview text does not get unintentionally cut off by layout constraints.
- [x] `npm run lint` has no new errors and `npm run build` succeeds.

## Subphase Index
* a — Diagnose layout + overflow root causes
* b — Fix scroll + responsiveness (min-h/min-w + button shrink rules)
* c — ChatGPT-like visual polish (messages, sidebar, spacing)
* d — QA + regression validation (manual + build checks)

## Phase Summary
- Root cause: nested flex/grid containers missing `min-h-0`/`min-w-0` prevented Radix `ScrollArea` from scrolling and caused horizontal overflow that was clipped by `overflow-hidden`.
- Fixes shipped:
  - `components/dashboard/insights-view.tsx` updated to `overflow-hidden` + `min-h-0` to support inner scrolling.
  - `components/dashboard/insights-chat-sheet.tsx` updated with `min-h-0`/`min-w-0` at the correct boundaries; controls are responsive and “Recompute/Regenerate” no longer clip; chat auto-scrolls to latest.
- Validation:
  - `npm run lint` (warnings only; no new errors)
  - `npm run build` (success)
- Note: Jam MCP confirmation was not possible in this environment (`Auth required`); manual UI repro verification is still recommended.
