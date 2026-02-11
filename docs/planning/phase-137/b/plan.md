# Phase 137b — UX Architecture & Discoverability Refinement

## Focus
Reduce cognitive load and improve task clarity across the dashboard, with priority on Settings IA and primary daily workflows.

## Inputs
- `docs/planning/phase-137/a/plan.md` outputs (severity-ranked findings)
- Existing navigation/state orchestration in:
  - `app/page.tsx`
  - `components/dashboard/sidebar.tsx`
  - `components/dashboard/settings-view.tsx`

## Work
1. Convert baseline findings into IA/actionability decisions:
   - Simplify user decision points in Settings.
   - Improve wayfinding from Sidebar to task-specific destinations.
2. Apply supporting Impeccable passes:
   - `impeccable-clarify` for labels/microcopy.
   - `impeccable-simplify` for reducing unnecessary complexity.
   - `impeccable-normalize` for consistent interaction and component patterns.
   - `impeccable-adapt` for desktop/tablet/mobile usability.
3. Define interaction contract updates:
   - Primary/secondary action hierarchy.
   - Consistent empty/loading/error state behavior.
   - Reduced UI competition in dense settings panels.
4. Produce an implementation-ready IA map with concrete component-level change list.

## Output
- Completed UX architecture refinement spec:
  - `docs/planning/phase-137/b/ux-architecture-refinement-spec.md`
  - includes IA restructuring model, discoverability/microcopy standards, and prioritized implementation slices (B1-B4)

## Handoff
Phase 137c should convert slices B1-B4 into measurable optimization work with explicit payload/render budgets and a before/after delta table.

## Validation (RED TEAM)
- `git status --porcelain` -> only phase-137 docs are modified in this turn
- Cross-phase scan -> no direct code overlap because this subphase produced planning artifacts only
- IA slice targets map directly to existing files confirmed in repo:
  - `components/dashboard/settings-view.tsx`
  - `components/dashboard/action-station.tsx`
  - `components/dashboard/crm-drawer.tsx`
  - `components/dashboard/analytics-view.tsx`
  - `components/dashboard/analytics-crm-table.tsx`
  - `components/dashboard/insights-view.tsx`
  - `components/dashboard/insights-chat-sheet.tsx`

## Progress This Turn (Terminus Maximus)
- Work done:
  - Converted 137a findings into an implementation-ready IA/discoverability spec.
  - Defined explicit refinement slices and acceptance checks for high-friction surfaces.
  - Locked 137b skill routing (`clarify/simplify/normalize/adapt`) and verification path (`critique/rams`).
- Commands run:
  - `git status --porcelain` — pass; docs-only updates.
  - `ls -dt docs/planning/phase-* | head -10` — pass; overlap scan refreshed.
- Blockers:
  - None for subphase 137b.
- Next concrete steps:
  - Start 137c with concrete performance budget definitions and first optimization candidates from lint/build/chunk baselines.

## Coordination Notes
**Files modified:** phase-137 planning docs only.  
**Potential conflicts with:** none in app code this subphase.  
**Integration notes:** 137c will be first code-touching stage; conflict checks must be re-run before edits.
