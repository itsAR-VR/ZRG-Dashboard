# Phase 156a — Settings Surface Inventory and Destination Matrix

## Focus
Create a complete inventory of current settings surfaces and lock a source-to-destination migration matrix so implementation decisions are deterministic.

## Inputs
- `docs/planning/phase-156/plan.md`
- `components/dashboard/settings-view.tsx`
- `components/dashboard/dashboard-shell.tsx`
- Access capability helpers (`actions/access-actions.ts`, `lib/workspace-capabilities.ts`)

## Work
1. Enumerate all cards/sections currently rendered in tabs: `general`, `integrations`, `ai`, `booking`, `team`, `admin`.
2. Classify each item into one of: `Setup`, `Model Selector`, `Controls`, `Observability`, `Legacy/Redundant`.
3. Produce a migration matrix with explicit target location for each item.
4. Mark deletion candidates where functionality is duplicated or non-actionable.
5. Confirm final top-level tab contract remains unchanged (`general|integrations|ai|booking|team|admin`).

## Output
- Decision-complete migration matrix that maps each existing settings surface to: `Keep`, `Move`, `Merge`, or `Remove`.

## Handoff
Use the matrix as the implementation contract for Phase `156b` section architecture and migration sequencing.

## Status
- Completed

## Progress This Turn (Terminus Maximus)
- Enumerated the active settings surfaces in `components/dashboard/settings-view.tsx` and applied the matrix below as the implementation contract.
- Locked top-level tab contract to `general|integrations|ai|booking|team|admin` (no new top-level tabs).

## Migration Matrix (Implemented Contract)
| Surface | Previous Location | Class | Action | Destination |
|---|---|---|---|---|
| `AiPersonaManager` | `ai` | Setup | Keep | `ai` |
| Qualification Questions | `ai` | Setup | Keep | `ai` |
| Knowledge Assets | `ai` | Setup | Keep | `ai` |
| Primary Website | `ai` | Setup | Keep | `ai` |
| Campaign Strategist model/reasoning | `ai` | Model Selector | Move | `admin > Model Selector` |
| Email Draft model/reasoning | `ai` | Model Selector | Move | `admin > Model Selector` |
| Step-3 Draft Verification model | `ai` | Model Selector | Move | `admin > Model Selector` |
| Campaign Strategist toggles | `ai` | Controls | Move | `admin > Controls` |
| AI Behavior Rules | `ai` | Controls | Move | `admin > Controls` |
| Follow-Up pause/resume | `ai` | Controls | Move | `admin > Controls` |
| AI Route Toggles | `admin` | Controls | Keep | `admin > Controls` |
| AI Route Switch Activity | `ai` | Observability | Move | `admin > Controls` |
| Bulk Draft Regeneration | `ai` | Controls | Move | `admin > Controls` |
| AI Dashboard | `ai` + `admin` | Observability | Merge | single `admin > Observability` |
| `AdminDashboardTab` | `admin` | Admin Surface | Keep | `admin > Observability` |
