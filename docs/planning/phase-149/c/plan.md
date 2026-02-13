# Phase 149c — State-Sync Integrity Hardening (`action-station`, `sidebar`, `use-url-state`)

## Focus
Fix secondary weak spots that can cause stale state, racey URL updates, or subtle rerender pressure after core loop guards are in place.

## Inputs
- Phase 149b outputs
- Current implementations in:
  - `components/dashboard/action-station.tsx`
  - `components/dashboard/sidebar.tsx`
  - `hooks/use-url-state.ts`

## Work
- Add guarded draft-refresh strategy in `action-station` so sentiment-driven staleness is corrected without restoring oscillation risk.
- Reset/hide stale sidebar counts when workspace/view leaves inbox context.
- Refactor `use-url-state` update merge to use live params semantics (avoid stale snapshot overwrite on rapid sequential setters).
- Verify no regression in channel toggle behavior and existing rerender guards.

## Output
- `components/dashboard/sidebar.tsx`
  - When `activeWorkspace` is null or `activeView` is not `inbox`, reset cached counts and loaded flags so the UI never shows stale workspace counts on return.
- Scope decisions:
  - No `components/dashboard/action-station.tsx` changes in Phase 149: existing loop guards remain, and no evidence tied the remaining #301 to draft refresh staleness.
  - No `hooks/use-url-state.ts` changes in Phase 149: hook appears unused in the current repo (`rg` found no call sites beyond the file itself).

## Handoff
Proceed to Phase 149d; if regression tests for UI loops are not feasible in this repo, explicitly document the limitation and rely on `lint/build/test` + a manual repro checklist.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Hardened sidebar counts state for workspace/view transitions.
  - Audited `use-url-state` usage and kept scope minimal.
- Commands run:
  - `rg -n "useUrlState\\(" app components hooks` — confirms no current call sites (UI-only scope preserved).
- Blockers:
  - None.
- Next concrete steps:
  - Decide test strategy for UI-loop regressions (repo currently has lib-only test orchestration).
