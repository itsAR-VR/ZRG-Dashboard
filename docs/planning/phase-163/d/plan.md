# Phase 163d — Frontend Stabilization: Refetch/Render Churn (React)

## Focus
Eliminate client-side refetch/render churn that amplifies variance, following React best practices (avoid unnecessary effects, stabilize dependencies, avoid derived-state effects).

## Inputs
- 163a packet identifying UI flows that correlate with slowness
- 163b headers to distinguish client-wait vs server-slow
- Key surfaces: `components/dashboard/inbox-view.tsx`, `components/dashboard/sidebar.tsx`, `components/dashboard/dashboard-shell.tsx`

## Work
1. Audit for React anti-patterns that cause churn:
   - effects that set state from props/state (derived state)
   - effects with unstable deps causing repeated runs
   - unstable query keys (objects/functions) triggering refetch
   - duplicated fetches caused by parallel suspense trees
2. Refactor with safe patterns:
   - compute derived values during render (or `useMemo` for expensive)
   - move event-driven updates into handlers
   - memoize stable primitives for query keys
   - ensure realtime reconnect does not cause tight polling loops
3. Add lightweight client debug toggles (dev-only / admin-only) if needed to surface:
   - refetch counts
   - last request id
   - cache status

## Output
- Reduced client refetch rate and smoother navigation even under slow backend conditions.

## Handoff
Provide stable selectors and deterministic waits for 163e Playwright perf tests (avoid flakiness).

