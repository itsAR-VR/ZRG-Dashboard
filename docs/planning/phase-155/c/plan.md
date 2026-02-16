# Phase 155c — Supabase Realtime Hardening (Session Auth + RLS + Invalidation)

## Focus
Replace anon-key realtime with session-authenticated subscriptions enforced by RLS, limited to `Lead INSERT + UPDATE`, and wired only to cache/query invalidation (not direct state mutation).

## Inputs
- Current realtime path in `lib/supabase.ts` (anon + `event: "*"`) is not acceptable for final state.
- Session browser client in `lib/supabase/client.ts`.
- Server auth helper in `lib/supabase/server.ts`.
- Inbox query invalidation patterns in dashboard components.

## Work
1. **RLS policy design and rollout**
   - Enable/selectively verify RLS on `Lead`.
   - Add `has_client_access(clientId text)` function (`SECURITY DEFINER`, locked `search_path`).
   - Add policy allowing SELECT only when user owns client or is in `ClientMember`.
   - Verify Realtime publication is configured to enforce RLS.

2. **Session-auth realtime helper**
   - Introduce `lib/realtime-session.ts`.
   - Use `createBrowserClient` session-aware client.
   - Preflight `auth.getSession()` before subscribing.
   - If no valid session, skip realtime and rely on heartbeat polling.

3. **Subscription scope**
   - Subscribe to `Lead` with:
     - `event: INSERT`
     - `event: UPDATE`
     - `filter: clientId=eq.<activeWorkspace>`
   - Do not subscribe to `Message`.
   - Remove dashboard usage of `lib/supabase.ts`.

4. **Workspace-switch lifecycle**
   - On workspace change:
     - teardown old channel first
     - then subscribe to new channel
   - Add short debounce to prevent rapid churn.

5. **Invalidation-only callback behavior**
   - Realtime callback must only do:
     - `queryClient.invalidateQueries` for inbox list/count keys
   - No unguarded `setState` calls from callback.

6. **Heartbeat fallback**
   - Keep 60s polling heartbeat.
   - Trigger immediate refetch on tab visibility regain.

## Validation
- Cross-tenant test: no events leak between inaccessible workspaces.
- Workspace switch test: no orphaned channels and no duplicate event handling.
- Expired session test: realtime gracefully disables, polling continues.
- React loop guard: callback does not trigger render storms.

## Output
- Tenant-safe realtime invalidation is live.
- Realtime path is session-authenticated and bounded.
- Heartbeat fallback remains intact for disconnect resilience.

## Handoff
Proceed to Phase 155d for analytics read-path completion and SLO attainment.

## Output (2026-02-16)
- Added session-authenticated realtime helper:
  - `lib/realtime-session.ts`
  - Uses `auth.getSession()` preflight before subscribing.
  - Restricts events to `Lead INSERT` + `Lead UPDATE` with `clientId=eq.<workspaceId>` filter.
  - Exposes explicit connection-state transitions (`subscribed`, `timed_out`, `channel_error`, `closed`, `session_missing`).
- Migrated dashboard subscriptions off anon realtime helper:
  - `components/dashboard/inbox-view.tsx`
  - `components/dashboard/crm-view.tsx`
  - Both now use `subscribeToWorkspaceLeadsRealtime(...)` and `unsubscribeRealtimeChannel(...)`.
- Inbox realtime callback is now invalidation-first with debounce (300ms) to reduce render churn and avoid callback-driven render loops.
- Added RLS rollout artifact for Supabase SQL editor:
  - `docs/planning/phase-155/c/realtime-rls-rollout.sql`
  - Includes `public.has_client_access(client_id text)` (`SECURITY DEFINER`, locked `search_path`), `Lead`/`InboxCounts` SELECT policies, and verification queries.

## Validation Evidence
- `npm run lint` ✅ (warnings only; no errors)
- `npm run typecheck` ✅
- `npm run build` ✅

## RED TEAM Pass (post-implementation)
- Closed:
  - Dashboard no longer consumes `lib/supabase.ts` anon realtime subscription path.
  - Realtime callback no longer mutates full conversation state directly; inbox path is cache-invalidation-driven with debounced refresh.
  - Workspace change teardown/resubscribe flow now uses explicit channel cleanup in both inbox and CRM views.
- Remaining operator checks:
  - Apply `docs/planning/phase-155/c/realtime-rls-rollout.sql` in Supabase production and confirm policy visibility queries.
  - Validate cross-tenant leak test manually after RLS rollout by switching between two workspaces with distinct user access.
