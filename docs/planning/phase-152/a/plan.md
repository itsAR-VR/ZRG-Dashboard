# Phase 152a — Consolidate InboxView Workspace Effects (Primary Fix)

## Focus
Merge the 4 fragmented workspace-dependent `useEffect` blocks in InboxView into 2 stable effects that use functional setters to bail out when values haven't changed. This eliminates the primary render cascade trigger — the `setActiveSentiments([])` creating a new array reference on every mount.

## Scope Decision (2026-02-14)
Execute the smallest high-confidence patch first: keep current effect structure and patch the known unstable update point only (`setActiveSentiments([])` on workspace change). Escalate to larger effect consolidation only if the crash still reproduces after deployment verification.

## Inputs
- Root cause analysis from Phase 152 context
- Current file: `components/dashboard/inbox-view.tsx`
- Phase 149's existing refetch guard at lines 376-390 (preserve this)

## Work

### 1. Pre-flight: read current file state
Re-read `components/dashboard/inbox-view.tsx` to ensure no concurrent changes since analysis.

### 2. Remove 4 separate effects
Delete these effect blocks:
- **Lines 189-193** — `useEffect([activeWorkspace])`: `setActiveSmsClient("all")`, `setActiveScoreFilter("all")`
- **Lines 195-207** — `useEffect([activeWorkspace, initialConversationId])`: selection resets + ref resets
- **Lines 844-847** — `useEffect([activeWorkspace])`: `setActiveSentiments([])`
- **Lines 849-854** — `useEffect([initialConversationId])`: redundant `setActiveConversationId(initialConversationId)`

### 3. Add 2 consolidated effects (in the same location as the removed effects, around line 189)

**Effect 1: Full workspace reset** — depends only on `[activeWorkspace]`
```typescript
// Reset all workspace-scoped state when switching workspaces.
// Uses functional setters to bail out when values are already at defaults
// (critical for key-based remount where initial state matches reset values).
useEffect(() => {
  setActiveSmsClient(prev => prev === "all" ? prev : "all")
  setActiveScoreFilter(prev => prev === "all" ? prev : "all")
  setActiveSentiments(prev => prev.length === 0 ? prev : [])
  setActiveConversationId(initialConversationId ?? null)
  setActiveConversation(null)
  setIsCrmOpen(false)
  setNewConversationCount(prev => prev === 0 ? prev : 0)
  setSyncAllCursor(prev => prev === null ? prev : null)
  leadLastMessageAtRef.current = new Map()
  workspaceLastMessageAtRef.current = 0
  activeConversationLastFetchedAtRef.current = new Map()
}, [activeWorkspace])
// Note: intentionally depends ONLY on activeWorkspace. The initialConversationId
// is read but not in the dep array — this effect handles workspace-level resets.
// Deep-link lead selection is handled by Effect 2.
```

**Effect 2: Deep-link lead selection** — depends only on `[initialConversationId]`
```typescript
// Handle deep-link lead selection changes (e.g., Slack "Edit in dashboard")
// without resetting workspace-level filters.
useEffect(() => {
  if (initialConversationId) {
    setActiveConversationId(prev =>
      prev === initialConversationId ? prev : initialConversationId
    )
  }
}, [initialConversationId])
```

### 4. Verify no other effects reference the removed lines
Search for any comments or variables that reference the old line numbers.

### 5. Run quality gates
```bash
npm run lint
npm run build
npm test
```

## Output
- `components/dashboard/inbox-view.tsx` now bails out workspace sentiment resets when state is already empty:
  - from `setActiveSentiments([])` to `setActiveSentiments((previous) => (previous.length === 0 ? previous : []))`
- This removes guaranteed array-reference churn on workspace switch/mount.
- Quality gates:
  - `npm run lint` passed (warnings only)
  - `npm run build` passed
  - `npm test` failed in concurrent `lib/*` scope (not dashboard path): `not ok 111 - repairShouldBookNowAgainstOfferedSlots` in `lib/__tests__/meeting-overseer-slot-selection.test.ts` (`Expected values to be strictly equal: null !== 2`)

## Handoff
Phase 152b/152c are intentionally deferred until live verification confirms whether the minimal 152a fix is sufficient. If React #301 still reproduces after this patch is deployed, continue to 152b with the red-team corrections in `docs/planning/phase-152/b/plan.md`.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Re-read current `InboxView` state/effects and confirmed unstable workspace sentiment reset remained.
  - Applied minimal functional-setter bail-out in `components/dashboard/inbox-view.tsx`.
  - Ran full quality-gate trio (`lint`, `build`, `test`) and captured exact failing suite details.
  - Performed multi-agent coordination scan (last 10 phases + `git status`) before and after edit.
- Commands run:
  - `git status --porcelain` — dirty tree present from concurrent `lib/*` work; no overlap with edited dashboard file.
  - `ls -dt docs/planning/phase-* | head -10` — scanned recent phase overlap (149/144 touched dashboard files).
  - `npm run lint` — pass; warnings only.
  - `npm run build` — pass.
  - `npm test` — fail; `not ok 111 - repairShouldBookNowAgainstOfferedSlots`.
  - `sed -n '1700,1765p' /tmp/phase152-test.log` — captured failing assertion details (`null !== 2`) from `lib/__tests__/meeting-overseer-slot-selection.test.ts:174`.
  - `npm start` — blocked by sandbox port restriction (`listen EPERM 0.0.0.0:3000`), so local runtime smoke-test is not possible in this environment.
- Blockers:
  - Global `npm test` is red due concurrent `lib/*` work unrelated to this workspace-switch patch.
  - Local `next start` runtime validation is blocked by sandbox network binding restrictions.
- Next concrete steps:
  - Validate the patch in deployed production bundle by repeatedly switching workspaces.
  - If crash persists, execute 152b using corrected integration points (see red-team notes in 152b plan).
  - If crash is resolved, close Phase 152 with review and residual-risk notes.

## Coordination Notes
- File overlap checked against recent phases:
  - Phase 149 and 144 both touched `components/dashboard/inbox-view.tsx`.
  - Current edit was surgical and merged on top of latest file state.
- Concurrent uncommitted work detected in `lib/*` from another agent; those changes likely explain the unrelated `npm test` failure.
