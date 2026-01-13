# Phase 17a — Fix Inbox “New” Badge (Realtime Scoping)

## Focus
Stop the Inbox “X new” badge from counting unrelated/global events, and avoid subscribing to the `Message` table on the client.

## Inputs
- Jam `681b2765-7977-4faf-9d20-33732951a3e6`
- `lib/supabase.ts`, `components/dashboard/inbox-view.tsx`, `components/dashboard/crm-view.tsx`

## Work
1. Added workspace scoping to the Lead realtime subscription using Supabase `postgres_changes` filters.
2. Removed Inbox browser subscription to `Message` changes (reduces noise + PII exposure).
3. Increment “new” only when a lead’s `lastMessageAt` moves forward and `lastMessageDirection === "inbound"`.
4. Reset badge + sync cursor when switching workspaces.

## Output
- Workspace-scoped realtime subscriptions:
  - `lib/supabase.ts` (`subscribeToLeads(..., { clientId })`)
  - `components/dashboard/inbox-view.tsx` (Lead-only subscription; new badge derived from rollups)
  - `components/dashboard/crm-view.tsx` (Lead insert subscription scoped to `activeWorkspace`)
- Verified build: `npm run build`.

## Handoff
Proceed to Phase 17b to improve GHL SMS sync freshness (timeouts + conversation fallback + safer dedupe).

