# Phase 27b — Cache-First Load UX

## Focus
Make the Insights Console feel instant by showing cached sessions/messages immediately and treating server refresh as background sync instead of a blocking loading state.

## Inputs
- Phase 27a output: answering works again
- Current cache logic in `components/dashboard/insights-chat-sheet.tsx`

## Work
- Change sessions loading UX to be **non-blocking**:
  - If cached sessions exist, keep rendering them while refreshing.
  - Move the spinner to a subtle “Refreshing…” indicator (header / footer) instead of replacing the list.
- Hydrate critical UI state from cache earlier:
  - Persist + restore `selectedSessionId` per workspace so the last-used session opens instantly.
  - Avoid first-render empty states by initializing state from localStorage where safe.
- Ensure cache writes are consistent:
  - Sessions: update cache on list refresh and on message send/regenerate (preview + updatedAt).
  - Messages: update cache optimistically, then reconcile with server IDs/timestamps.

## Output
- Sessions sidebar no longer hides cached sessions behind a blocking “Loading…” state:
  - Cached sessions render immediately while the server refresh runs in the background.
  - A small spinner in the sidebar header indicates refresh-in-progress.
- Persisted per-workspace last-selected session in localStorage for faster “resume where you left off”.
- Code: `components/dashboard/insights-chat-sheet.tsx`

## Handoff
Proceed to Phase 27c to debug why campaign scope appears broken for CUSTOM windows (Jam repro) and ensure the selected scope is respected in pack builds/recomputes.
