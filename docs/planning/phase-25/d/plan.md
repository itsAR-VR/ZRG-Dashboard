# Phase 25d — QA + Regression Validation

## Focus
Validate the Insights Console fixes via manual repro and repository checks, ensuring no regressions.

## Inputs
- Implemented changes from Phase 25b/25c.
- Original repro symptoms (scroll broken, right-side clipped, missing actions).

## Work
- Manual verification checklist (recommended after pulling this branch):
  - Open Insights → confirm sessions list scrolls when long.
  - Open a long session → confirm messages scroll and the composer stays visible.
  - Resize to narrower widths → confirm “Recompute” + “Regenerate” remain visible and usable (they should stack on small widths).
  - Send a message → confirm the view scrolls to the newest message.
- Repo checks (completed locally):
  - `npm run lint` (no new errors; existing warnings only)
  - `npm run build` (success)
- Jam tooling:
  - Jam MCP could not be used here (`Auth required`), so Jam-based confirmation should be done once Jam auth is available.

## Output
- Validation results:
  - `npm run lint` passes with existing warnings.
  - `npm run build` succeeds.
  - Layout fixes are applied at the correct flex/ScrollArea boundaries (`min-h-0`), and control clusters are responsive (`min-w-0` + wrap/shrink), so the original repro should be resolved.

## Handoff
If everything passes in manual UI verification, prepare a focused commit containing only:
- `components/dashboard/insights-view.tsx`
- `components/dashboard/insights-chat-sheet.tsx`
- `docs/planning/phase-25/*`
