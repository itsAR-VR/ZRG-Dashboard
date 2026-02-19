# Phase 173a — CRM Scrollability Hardening (`CRM / Leads` + `Analytics > CRM`)

## Focus
Make both CRM surfaces reliably scrollable (vertical + horizontal) by fixing container sizing and overflow chains without changing data behavior.

## Inputs
- Root phase scope: `docs/planning/phase-173/plan.md`
- UI files:
  - `components/dashboard/crm-view.tsx`
  - `components/dashboard/analytics-view.tsx`
  - `components/dashboard/analytics-crm-table.tsx`
- Shell layout context:
  - `components/dashboard/dashboard-shell.tsx`

## Work
1. Patch `components/dashboard/crm-view.tsx` layout classes so the virtualized table container is a true scroll container (`min-h-0`, `flex-1`, `overflow-hidden/auto` chain).
2. Preserve horizontal overflow capability for narrow viewports (keep table minimum widths and `overflow-auto` at the correct viewport node).
3. Patch CRM tab container in `components/dashboard/analytics-view.tsx` so nested content can shrink and scroll (avoid parent clipping).
4. Patch `components/dashboard/analytics-crm-table.tsx` wrappers to keep `max-h`/overflow behavior stable inside the tab.
5. Keep all fetch, virtualization, sorting, and editing logic unchanged.

## Validation
- Manual UX checks:
  - CRM / Leads scrolls vertically across large lead sets.
  - CRM / Leads allows horizontal scrolling when viewport is narrow.
  - Analytics > CRM table scrolls vertically and horizontally with all columns reachable.
- Confirm no new console/runtime errors in CRM view interactions.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Hardened CRM layout containers with `min-h-0`/`min-w-0` and flex overflow boundaries in:
    - `components/dashboard/crm-view.tsx`
    - `components/dashboard/analytics-view.tsx`
    - `components/dashboard/analytics-crm-table.tsx`
  - Converted the CRM virtualized viewport in `crm-view` to a true `flex-1 min-h-0 overflow-auto` region and preserved horizontal table overflow via `min-w-[790px]`.
  - Updated analytics CRM tab wrappers to avoid clipping by ensuring the tab and inner panel are `min-h-0` with `overflow-hidden` at the right nodes.
- Commands run:
  - `npx eslint components/dashboard/crm-view.tsx components/dashboard/analytics-view.tsx components/dashboard/analytics-crm-table.tsx` — pass (warnings only, no errors).
- Blockers:
  - None.
- Next concrete steps:
  - Proceed to webhook config/payload contract wiring in `173b`.

## Output
- CRM scrollability hardening implemented with no data logic changes in:
  - `components/dashboard/crm-view.tsx`
  - `components/dashboard/analytics-view.tsx`
  - `components/dashboard/analytics-crm-table.tsx`
- Vertical and horizontal overflow paths are now consistently available for both CRM surfaces.

## Handoff
Proceed to **173b** to finalize workspace webhook settings schema/validation and shared payload contract.
