# Phase 153c — Persist Workspace Selection in URL (`clientId`)

## Focus
Make manual workspace switches update the URL query string so:
- refresh restores the selected workspace, and
- back/forward navigation behaves predictably.

This phase standardizes on `?clientId=...` (not `?workspace=...`) to align with existing deep-link behavior in `DashboardShell`.

## Inputs
- Current behavior: `components/dashboard/dashboard-shell.tsx` reads `clientId` from `useSearchParams()` on mount, but manual workspace changes do not update the URL.
- Locked decision: persist selection via `clientId`.

## Work
1. Pre-flight conflict check:
   - `git status --porcelain`
   - re-read `components/dashboard/dashboard-shell.tsx` workspace selection logic.
2. Update `handleWorkspaceChange(nextWorkspace)` to:
   - set local state as today (`workspaceSelectionMode`, `selectedLeadId`, `activeWorkspace`)
   - additionally update the URL via `router.replace(...)`:
     - set `clientId` when `nextWorkspace` is non-null
     - delete `clientId` when switching to “All Workspaces”
     - preserve other query params (`view`, `leadId`, `draftId`, `settingsTab`, `action`, etc.)
     - if not deep-linked (`leadId` absent), ensure any stale `leadId` is cleared from the URL when switching workspaces.
3. Confirm deep-link behavior remains correct:
   - URLs that already include `?leadId=...&clientId=...` must keep loading the correct workspace.

## Output
- Implemented in `components/dashboard/dashboard-shell.tsx`:
  - Added `useRouter` and `usePathname` usage in `DashboardPageInner`.
  - Updated `handleWorkspaceChange(nextWorkspace)` to `router.replace(...)` with preserved existing params and updated `clientId`.
  - Clears stale `leadId` from URL on manual switch when no deep-link lead is present.
- Manual workspace switches now persist in URL and survive refresh.

## Handoff
Proceed to Phase 153d for validation gates (including NTTAN) and final manual repro confirmation.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Re-read `DashboardShell` workspace selection path and confirmed URL state was not updated on manual workspace change.
  - Added URL persistence logic using existing search params to avoid clobbering unrelated query keys.
  - Preserved current deep-link semantics (`clientId` + `leadId`) and state updates.
- Commands run:
  - `sed -n '1,260p' components/dashboard/dashboard-shell.tsx` — verified current imports and workspace logic.
  - `rg -n "handleWorkspaceChange|clientId|useRouter|usePathname" components/dashboard/dashboard-shell.tsx` — verified target symbols after edit.
- Blockers:
  - None for this subphase.
- Next concrete steps:
  - Run and record all 153d validation gates.
