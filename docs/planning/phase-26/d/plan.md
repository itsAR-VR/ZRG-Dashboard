# Phase 26d — Performance: local cache + revalidation strategy

## Focus
Speed up perceived and real load times by caching sessions/messages/packs locally (cross-refresh), while keeping workspace boundaries and soft-delete semantics correct.

## Inputs
- Existing session/message list API calls in `actions/insights-chat-actions.ts`
- UI: `components/dashboard/insights-chat-sheet.tsx`
- Constraint: do not leak secrets; store only what’s safe on the client.

## Work
1. Define what to cache:
   - Session list (id, title, updatedAt, lastMessagePreview)
   - Message list per session (role, content, createdAt, citations metadata)
   - Latest pack metadata (status, counts, computedAt)
2. Choose storage:
   - IndexedDB (preferred for size) or localStorage (fallback for small items).
3. Invalidation rules:
   - Key by `clientId` + `sessionId`.
   - Use `updatedAt` to detect staleness and background refresh.
   - Respect soft-delete: cached deleted sessions should be hidden unless “include deleted” is toggled.
4. UX improvements:
   - Render cached content immediately with a “Refreshing…” subtle indicator.
   - Background refetch updates the UI without jarring jumps.

## Output
- Implemented SWR-style local caching (localStorage) in `components/dashboard/insights-chat-sheet.tsx`:
  - Caches session list per workspace (separate keys for “include deleted” vs “active”).
  - Caches messages per session (including citations) and latest pack metadata.
  - Rehydrates `Date` fields on read to preserve existing UI behavior.
  - Loads cached content immediately (when available), then refreshes from server and rewrites cache.

## Handoff
Phase 26e uses the improved UI + speed to add an “Apply insights” layer that makes outputs easier to operationalize.
