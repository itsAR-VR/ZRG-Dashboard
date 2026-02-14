# Phase 152b — Add DashboardShell Workspace Transition Guard

## Status (2026-02-14)
Deferred pending live validation outcome from 152a minimal patch.

## RED TEAM Corrections (2026-02-14)
- `components/dashboard/dashboard-shell.tsx` currently uses `renderContent(view, isActiveView)`, not `renderView`.
- If this subphase is executed, apply the transition placeholder check at the top of `renderContent` (before the switch), or gate the render call-site in JSX; do not target a non-existent `renderView` symbol.

## Focus
Add a one-frame transition guard in DashboardShell that briefly unmounts the active view when `activeWorkspace` changes. This provides a clean break between the old and new component instances, preventing any interference from simultaneous cleanup and mount effects. The guard covers ALL workspace change sources (dropdown click, URL sync, `syncWorkspaces`).

## Inputs
- Phase 152a: consolidated effects in InboxView (reduces cascade volume)
- Current file: `components/dashboard/dashboard-shell.tsx`
- The existing key-based remount (`key={inbox:${workspaceKey}}`) is kept as defense-in-depth

## Work

### 1. Pre-flight: read current file state
Re-read `components/dashboard/dashboard-shell.tsx` to ensure no concurrent changes.

### 2. Add transition state and effect

In `DashboardPageInner`, add near the existing state declarations (around line 180):

```typescript
// Workspace transition guard: briefly unmount views when workspace changes
// to provide clean separation between old cleanup and new mount effects.
const [isTransitioning, setIsTransitioning] = useState(false)
const prevWorkspaceRef = useRef(activeWorkspace)
```

Add two effects after the existing `workspaceSelectionMode` ref sync (around line 232):

```typescript
// Detect workspace changes from ANY source (dropdown, URL, syncWorkspaces)
useEffect(() => {
  if (prevWorkspaceRef.current !== activeWorkspace && prevWorkspaceRef.current !== null) {
    prevWorkspaceRef.current = activeWorkspace
    setIsTransitioning(true)
  } else {
    prevWorkspaceRef.current = activeWorkspace
  }
}, [activeWorkspace])

// Clear transition after one animation frame (allows cleanup effects to settle)
useEffect(() => {
  if (!isTransitioning) return
  const id = requestAnimationFrame(() => setIsTransitioning(false))
  return () => cancelAnimationFrame(id)
}, [isTransitioning])
```

### 3. Modify `renderContent` to show loading during transition

At the top of the `renderContent` function (before the switch statement, around line 356):

```typescript
if (isTransitioning) {
  return <div className="flex-1 animate-pulse rounded bg-muted/30" />
}
```

### 4. Verify behavior
- The guard skips the initial mount (prevWorkspaceRef starts at `activeWorkspace`, so no transition on first render)
- The guard activates on workspace changes from any source
- The loading skeleton matches the existing `dynamicViewLoadingFallback` style
- One `requestAnimationFrame` = ~16ms at 60fps, imperceptible to users

### 5. Run quality gates
```bash
npm run lint
npm run build
npm test
```

## Output
- `components/dashboard/dashboard-shell.tsx` has a workspace transition guard
- Views briefly unmount during workspace switch, providing clean effect separation
- The guard covers dropdown clicks, URL-driven switches, and `syncWorkspaces` changes
- Quality gates pass

## Handoff
Phase 152c stabilizes ActionStation's callback chain and runs end-to-end verification. The transition guard from 152b + consolidated effects from 152a should together eliminate the React #301 crash.
