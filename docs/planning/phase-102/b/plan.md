# Phase 102b — Implement Table Layout Revert (Preserve Phase 97 Header Extras)

## Focus
Revert the Campaign Assignment UI layout back to a table while preserving newer functional/insight additions and keeping all behaviors intact.

## Inputs
- Phase 102a patch outline
- Baseline table layout: `ce4cf747:components/dashboard/settings/ai-campaign-assignment.tsx`
- Current implementation: `components/dashboard/settings/ai-campaign-assignment.tsx`

## Work
1. Update imports:
   - Remove: `Collapsible`, `CollapsibleContent`, `CollapsibleTrigger`, `Slider`, `ChevronDown`, `cn`.
   - Add: `Table`, `TableBody`, `TableCell`, `TableHead`, `TableHeader`, `TableRow`.
2. Remove unused state:
   - Delete `expandedRows` state and any open/close handlers.
3. Restore table-based render for non-empty `rows`:
   - Replace the current `<div className="space-y-3">…</div>` card list with a `<Table>` matching the baseline columns.
   - Keep all existing edit controls:
     - Mode select
     - Threshold numeric input + percent badge (disabled unless AI auto-send)
     - Delay min/max numeric inputs (disabled unless AI auto-send)
     - Schedule select + custom schedule editor (days/times/blackout dates/ranges)
     - Booking process select
     - Persona select
     - Save/Revert actions
4. Preserve Phase 97 header extras:
   - Keep “Last {days}d…” auto-send stats line rendering.
   - Keep mismatch badge count in the header.
5. Preserve per-row mismatch warning:
   - Render a small warning line under the campaign ID (or under the mode helper text) inside the table, without adding new columns.
6. Ensure the file compiles and no other files are touched.

## Output
- `components/dashboard/settings/ai-campaign-assignment.tsx` uses the table layout again, with Phase 97 header insights preserved.

## Coordination Notes

**Integrated from Phase 97:** Preserved header mismatch badge + auto-send stats line while reverting layout.  
**Files affected:** `components/dashboard/settings/ai-campaign-assignment.tsx`  
**Potential conflicts with:** None (Phase 97 complete in history).

## Handoff
Proceed to Phase 102c to run lint/build and manually sanity-check the Booking tab.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Replaced the collapsible card layout with the pre–Phase 92 table layout.
  - Restored numeric threshold input and table column structure.
  - Preserved Phase 97 header insights and row-level “AI Responses” warning.
  - Removed unused imports/state (`Collapsible*`, `Slider`, `ChevronDown`, `cn`, `expandedRows`) and re-added `Table*`.
- Commands run:
  - `rg -n "Collapsible|Slider|ChevronDown|expandedRows|cn\\(" components/dashboard/settings/ai-campaign-assignment.tsx` — pass (no matches)
- Blockers:
  - None
- Next concrete steps:
  - Run `npm run lint` and `npm run build`.
  - Manually smoke test Settings → Booking → Campaign Assignment.
