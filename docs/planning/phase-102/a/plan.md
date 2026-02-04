# Phase 102a — Audit Current UI vs Pre–Phase 92 Table Baseline

## Focus
Confirm the exact UI delta to revert (Campaign Assignment layout only), identify what must be preserved from newer phases, and produce a decision-complete patch outline for implementation.

## Inputs
- Root intent: `docs/planning/phase-102/plan.md`
- Current UI file: `components/dashboard/settings/ai-campaign-assignment.tsx`
- Pre–Phase 92 baseline for layout: `git show ce4cf747:components/dashboard/settings/ai-campaign-assignment.tsx` (table-based layout)
- Phase 97 extras to preserve: header insights/badges currently present in `components/dashboard/settings/ai-campaign-assignment.tsx`
- Booking tab container is out-of-scope: `components/dashboard/settings-view.tsx` (keep “Booking configuration notes” alert)

## Work
1. Confirm the user decisions are implementable without touching any other Booking-tab UI:
   - Revert **only** campaign assignment layout in `ai-campaign-assignment.tsx`.
2. Diff baseline vs current and identify what is strictly “layout polish” to remove:
   - Current: collapsible card list per campaign + slider threshold control.
   - Baseline: table row per campaign + numeric threshold input.
3. Identify Phase 97 (and later) behavior/insight additions to preserve:
   - Header “Last 30d …” auto-send stats line (if available).
   - Header mismatch badge for “AI Responses” naming vs mode.
   - Per-row mismatch warning (keep, but re-home into a table cell).
4. Build the implementation checklist for Phase 102b:
   - Replace the current `rows.map()` card layout with the baseline `<Table>` layout.
   - Keep current save/revert handlers and dirty-state logic unchanged.
   - Remove now-unused imports/state (`Collapsible*`, `Slider`, `ChevronDown`, `cn`, `expandedRows`).
   - Re-add required table imports (`Table*`).

## Output
- A concrete patch outline:
  - Swap the current `<div className="space-y-3">` + `<Collapsible>` card list under the rows map for the pre–Phase 92 `<Table>` layout.
  - Place the per-row “AI Responses” mismatch warning as a small line under the campaign ID in the **Campaign** table cell (no new columns).
  - Clean up imports/state: remove `Collapsible*`, `Slider`, `ChevronDown`, `cn`, and `expandedRows`; re-add `Table*` imports.

## Handoff
Proceed to Phase 102b to implement the table layout revert in `components/dashboard/settings/ai-campaign-assignment.tsx`.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Confirmed current layout uses `Collapsible` cards + slider threshold control.
  - Verified pre–Phase 92 baseline renders a table with numeric threshold input.
  - Identified Phase 97 header extras to preserve (stats line + mismatch badge).
- Commands run:
  - `git status --porcelain` — pass (noted unrelated uncommitted changes)
  - `ls -dt docs/planning/phase-* | head -10` — pass
  - `rg -n "Campaign Assignment|Collapsible|Table" components/dashboard/settings/ai-campaign-assignment.tsx` — pass
  - `git show ce4cf747:components/dashboard/settings/ai-campaign-assignment.tsx | rg -n "<Table"` — pass
- Blockers:
  - None
- Next concrete steps:
  - Implement the table layout revert and import/state cleanup in Phase 102b.
