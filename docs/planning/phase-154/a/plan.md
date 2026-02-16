# Phase 154a — GET Read APIs + Shared Query Extraction (Conversations + Detail + Counts)

## Focus
Introduce explicit GET read endpoints for the inbox (list, counts, detail) and extract shared query logic so Server Actions and API routes use the same implementation. This is the foundation for caching, realtime invalidation, and durable job triggers.

## Inputs
- Current read entrypoints:
  - `actions/lead-actions.ts`: `getConversationsCursor`, `getConversation`, `getInboxCounts`
  - UI: `components/dashboard/inbox-view.tsx` and `components/dashboard/sidebar.tsx`
- Auth/scoping utilities:
  - `lib/workspace-access.ts` (`resolveClientScope`, SETTER role scoping)
  - Supabase SSR session via `lib/supabase/server.ts`
- Phase 153 WIP note: `components/dashboard/inbox-view.tsx` currently has uncommitted edits; do not start this subphase until git state is reconciled.

## Work
1. Pre-flight conflict check:
   - `git status --porcelain`
   - Read Phase 153 plan + confirm whether `components/dashboard/inbox-view.tsx` changes are committed/merged or intentionally stashed.
2. Create shared inbox query module:
   - New file: `lib/inbox/queries.ts`
   - Export:
     - `fetchConversationsCursor(scope, options)` (parity with `getConversationsCursor`)
     - `fetchConversationDetail(scope, leadId, channelFilter?)` (parity with `getConversation`)
     - `fetchInboxCounts(scope, clientId?)` (parity with `getInboxCounts` semantics)
   - Keep parsing/coercion at the edges (route handler/server action), not inside the core query functions.
3. Add route handlers (GET APIs):
   - `app/api/inbox/conversations/route.ts`
     - Parses query params to `ConversationsCursorOptions`
     - Calls `resolveClientScope(clientId)` and then `fetchConversationsCursor(...)`
     - Returns structured JSON and safe status codes (401/403/500)
   - `app/api/inbox/conversations/[leadId]/route.ts`
     - Validates lead access via `requireLeadAccessById` or `resolveClientScope` + lead lookup
     - Calls `fetchConversationDetail(...)`
   - `app/api/inbox/counts/route.ts`
     - Requires `clientId` (match current sidebar behavior), or returns empty counts when missing
     - Calls `fetchInboxCounts(...)`
4. Migrate UI reads to GET APIs:
   - `components/dashboard/inbox-view.tsx`
     - Replace `getConversationsCursor` and `getConversation` client calls with `fetch('/api/inbox/...')` based reads.
     - Keep Server Actions for writes only (sync enqueue, send message, reanalyze).
   - `components/dashboard/sidebar.tsx`
     - Replace `getInboxCounts(activeWorkspace)` with GET `/api/inbox/counts?clientId=...`.
5. Parity checks:
   - Ensure response shapes match existing consumers (minimal UI changes).
   - Ensure SETTER scoping and snooze filtering match current Server Action behavior.

## Output
- New GET endpoints exist and are used by the inbox UI for reads.
- Shared query logic lives in `lib/inbox/queries.ts` and is reused by Server Actions (thin wrappers) and route handlers.

## Handoff
Proceed to Phase 154b to add Vercel KV caching and invalidation around the new read APIs.

