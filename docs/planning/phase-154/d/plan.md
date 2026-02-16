# Phase 154d — Supabase Realtime (Sessioned + RLS) + Client Invalidation + Remove High-Frequency Polling

## Focus
Stop polling loops by pushing “workspace changed” signals to the client via Supabase Realtime, while making the realtime layer enterprise-safe with session auth + RLS.

## Inputs
- Current realtime client: `lib/supabase.ts` (anon-key based)
- Recommended sessioned browser client: `lib/supabase/client.ts`
- UI polling points:
  - `components/dashboard/inbox-view.tsx` `refetchInterval`
  - `components/dashboard/sidebar.tsx` `setInterval` counts polling

## Work
1. Replace anon realtime client usage:
   - Stop using `lib/supabase.ts` for inbox realtime.
   - Use sessioned browser client (`lib/supabase/client.ts`) so realtime subscriptions carry the user session.
2. Add/verify RLS policies in Supabase:
   - `Lead`: users can select rows only for workspaces they can access.
   - `inbox_counts`: same.
   - Ensure subscriptions cannot filter to arbitrary `clientId` outside membership.
3. Add realtime subscriptions:
   - Subscribe to `inbox_counts` row changes for the active workspace.
   - Optionally subscribe to `Lead` changes scoped to `clientId` for “new message” badge signals (avoid subscribing to `Message` rows in the browser).
4. Client invalidation strategy:
   - On `inbox_counts` change event:
     - invalidate counts query cache
     - invalidate conversation list query cache (or bump a “realtime epoch” used in query keys)
   - Debounce invalidations (250-500ms) to avoid event storms.
5. Remove high-frequency polling:
   - `Sidebar`: remove `setInterval` when realtime is connected; keep a slow fallback (e.g., 60s) only when realtime is disconnected.
   - `InboxView`: disable `refetchInterval` when realtime is connected; keep a slow fallback when disconnected.

## Output
- Inbox reads are refreshed by realtime invalidation instead of periodic polling.
- Realtime is session-authenticated and tenancy-safe via RLS.

## Handoff
Proceed to Phase 154e to introduce durable background jobs and convert cron endpoints to enqueue-only triggers.

