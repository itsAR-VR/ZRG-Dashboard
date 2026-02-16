# Phase 155c — Supabase Realtime Enterprise Hardening (Session Auth + RLS + Invalidation Wiring)

## Focus
Replace anon-key Realtime subscriptions with a session-authenticated Supabase client protected by RLS, and use realtime events to invalidate inbox list/counts while retaining a 60s heartbeat for consistency.

## Inputs
- Existing realtime client: `lib/supabase.ts` (anon-key, `postgres_changes` on `Lead`)
- Supabase SSR helpers:
  - `lib/supabase/client.ts` (browser client)
  - `lib/supabase/server.ts` (server client)
- Access model:
  - `Client.userId` (owner)
  - `ClientMember(userId, role)`
  - `lib/workspace-access-filters.ts:accessibleClientWhere`
- Polling policy (locked): realtime + 60s heartbeat
- Realtime scope (locked): `Lead` INSERT + UPDATE only

## Work
1. Implement RLS for Lead subscriptions
   - Enable RLS on `Lead`.
   - Add a helper function `has_client_access(client_id uuid)` (SECURITY DEFINER) that returns true if:
     - `Client.userId = auth.uid()`, OR
     - exists `ClientMember` for `(clientId, userId = auth.uid())`
   - Policy:
     - `SELECT` on `Lead` allowed when `has_client_access(Lead.clientId)`
   - Confirm Supabase Realtime is configured to enforce RLS for `postgres_changes`.

2. Replace client-side realtime plumbing
   - Deprecate `lib/supabase.ts` usage in dashboard components.
   - Implement a new subscription helper that uses the session-auth browser client from `lib/supabase/client.ts`.
   - Subscribe to `Lead`:
     - events: INSERT + UPDATE
     - filter: `clientId=eq.<activeWorkspace>`

3. Wire realtime → React Query invalidation (not state mutation)
   - On relevant lead changes:
     - invalidate the inbox list query key(s)
     - invalidate counts query/read path
   - Ensure invalidation does not cascade into render loops:
     - do not call setters unconditionally
     - do not rebuild query keys as objects

4. Polling consistency
   - Keep a 60s heartbeat refetch even when realtime is healthy (silent disconnect guard).
   - When page becomes visible, do an immediate refetch (already present in inbox/sidebar patterns).

5. Verification
   - Confirm no cross-tenant events appear while subscribed.
   - Confirm workspace switching correctly tears down old channel and subscribes to the new one.

## Output
- Inbox realtime is session-authenticated and protected by RLS.
- Inbox freshness uses realtime invalidation plus a 60s heartbeat without polling storms.

## Handoff
Proceed to Phase 155d to complete analytics GET read APIs + caching + chunking and add bounded session persistence for perceived performance.

