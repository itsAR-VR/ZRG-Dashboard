# Phase 156b — Admin IA Contract (`Model Selector`, `Controls`, `Observability`)

## Focus
Define and scaffold the new `Admin` information architecture so operational AI configuration has one authoritative location.

## Inputs
- `docs/planning/phase-156/plan.md`
- Phase `156a` migration matrix
- Current admin/AI render blocks in `components/dashboard/settings-view.tsx`

## Work
1. Define Admin section order and ownership:
   - `Model Selector`
   - `Controls`
   - `Observability`
   - Remaining `AdminDashboardTab` content
2. Establish section-level rendering boundaries so each card appears in exactly one section.
3. Keep existing save state and handlers wired to current settings model (no payload/schema change).
4. Preserve prompt-governance access entrypoint (`View Prompts`) within Admin observability/governance surfaces.

## Output
- Stable Admin section contract ready for card migration in the next subphase.

## Handoff
Phase `156c` moves AI tab model/control cards into the new Admin structure without changing persistence semantics.

## Status
- Completed

## Progress This Turn (Terminus Maximus)
- Implemented Admin section contract in `components/dashboard/settings-view.tsx` with ordered sections:
  1. `Model Selector`
  2. `Controls`
  3. `Observability`
- Preserved existing state/save wiring (`handleSaveSettings` payload shape unchanged).
- Preserved prompt-governance entrypoint (`View Prompts`) in Admin surfaces.

## Section Ownership (Implemented)
- `Model Selector`: Campaign Strategist model/reasoning, Email Draft model/reasoning, Step-3 Draft Verification model.
- `Controls`: Campaign Strategist runtime toggles, AI Behavior Rules, Follow-Up pause/resume, AI Route Toggles, AI Route Switch Activity, Bulk Draft Regeneration.
- `Observability`: single `AI Dashboard` card plus `AdminDashboardTab`.
