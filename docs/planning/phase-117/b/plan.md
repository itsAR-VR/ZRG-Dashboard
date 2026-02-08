# Phase 117b — Fix: Make Inbox Server Actions Non-500 + Guard Client Query Initiation

## Focus
Eliminate the launch blocker by ensuring inbox-related Server Actions never surface as a “Server Components render” digest-only error in the UI, and by preventing known-bad/expensive calls during initial load.

## Inputs
- Root cause output from Phase 117a (which failure class we’re fixing)
- Server actions:
  - `actions/client-actions.ts:getClients`
  - `actions/lead-actions.ts:getConversationsCursor`
- Client callsites:
  - `app/page.tsx` (workspace fetch + initial workspace selection)
  - `components/dashboard/inbox-view.tsx` (React Query `useInfiniteQuery`)

## Work
1. Make Server Actions resilient to malformed/edge inputs (no throws)
   - Add runtime parsing/coercion at the start of the action(s) most implicated by the Jam.
   - For `getConversationsCursor(options)`:
     - Coerce unknown `options` to an object.
     - Treat invalid `clientId`/`cursor` types as `null`.
     - Treat `channels`/`sentimentTags` that are not arrays as `undefined`.
     - Treat invalid `filter` / `scoreFilter` values as `undefined`.
   - Ensure the action returns `{ success: false, error: <safe message> }` for:
     - unauthenticated
     - unauthorized
     - workspace not found
     - DB errors / timeouts (but with a short, non-PII error string)
   - Ensure Server Action return values are safe to cross the Server→Client boundary (RT-12):
     - Do not return `Date` objects (convert to ISO strings) and do not return `Error` objects.
     - Apply to both `getClients()` and `getConversationsCursor()` outputs.
     - Decision-complete mapping:
       - `actions/client-actions.ts:getClients`:
         - omit `createdAt` from the returned payload (it is not used by the dashboard UI), or convert it to `createdAtIso: string`.
       - `actions/lead-actions.ts:getConversationsCursor`:
         - convert all `Date | null` fields in `ConversationData` to ISO strings (e.g., `lead.currentReplierSince`, `lead.scoredAt`, `lead.assignedAt`, and message `timestamp`).
       - Any conversation-detail action used by the inbox (e.g., `getConversation`) must apply the same rule for message timestamps.

2. Prevent invalid filter values from being sent (RT-6)
   - In `components/dashboard/inbox-view.tsx:265`, stop casting `activeFilter` (empty string `""`) into the union type.
   - Convert `""` into `undefined` explicitly before calling the action:
     - `filter: activeFilter ? (activeFilter as ...) : undefined`

3. Guard initial inbox query initiation (RT-2 + RT-NEW-1)
   - Policy: **support "All Workspaces"** (no selected workspace) without hitting the Server Action with invalid placeholder params.
   - Add a React Query `enabled` gate at `inbox-view.tsx:287` based on "params are valid / ready":
     - enable once the app has loaded the workspace list (or otherwise has a stable client scope), and the query args are valid primitives.
     - Ensure first-page cursor is `null/undefined` (NOT `{}`):
       - set `initialPageParam: null` (TanStack Query) and pass `cursor: pageParam ?? undefined`.
     - Ensure `clientId` is `string | null` only:
       - pass `clientId: activeWorkspace ?? null` (where `null` means "All Workspaces").
   - Gate polling interval on readiness (and fail-closed on errors):
     - `refetchInterval: isEnabled ? 30000 : false`
     - Disable polling while unauthenticated/unauthorized or while in an error loop.
   - Ensure UX fallback:
     - When "All Workspaces" is active, render the combined conversations list.
     - When workspaces fail to load, show a visible error state + retry (see step 5) instead of silently cascading into a 500 loop.

4. Add env guard in `lib/prisma.ts` (RT-1 — unconditional, not "if applicable")
   - Add a guard before the PrismaPg adapter initialization:
     - `if (!process.env.DATABASE_URL) throw new Error("[prisma] DATABASE_URL is not set — check Vercel env vars")`
   - This converts a cryptic module-load crash into a readable error in Vercel logs.
   - If DB statement timeout / perf is the issue:
     - reduce query cost for the initial list (indexes, narrower includes, smaller batch size), but keep changes minimal and measurable.

5. Add error handling for `getClients()` failure in `app/page.tsx` (RT-3 — NEW)
   - **File:** `app/page.tsx:70-78`
   - Currently: if `result.success === false`, nothing happens — workspace list stays empty, no user feedback.
   - Fix: add an `else` branch that:
     - Sets an error state (e.g., `setWorkspaceError(result.error || "Failed to load workspaces")`)
     - Shows a visible error banner or toast to the user
     - Optionally adds a retry button or `fetchWorkspaces().catch(console.error)` safety net
   - This prevents the silent failure cascade: failed workspace fetch → null activeWorkspace → premature conversation query.

6. Apply auth-error silencing pattern to `getConversationsCursor` (RT-11 — NEW)
   - **File:** `actions/lead-actions.ts:1409-1418`
   - Currently: `console.error` fires for ALL errors including "Not authenticated" / "Unauthorized". With `refetchInterval: 30000`, expired sessions produce error logs every 30 seconds.
   - Fix: apply the existing `getInboxCounts` pattern (line 773-778):
     ```
     if (message === "Not authenticated" || message === "Unauthorized") {
       return { success: false, conversations: [], nextCursor: null, hasMore: false };
     }
     ```
   - This silences expected auth errors from log spam while preserving the structured error return.

## Validation (RED TEAM)
- Local:
  - Navigate to `/` and confirm:
    - workspaces load (no action 500)
    - selecting a workspace loads conversations
    - "All Workspaces" loads conversations (combined view) without errors
    - filtering does not crash and does not send invalid filter values
  - Run: `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`
- Production smoke (after deploy):
  - Login → Master Inbox shows conversations and no “Server Components render” error.
  - Retry button is not needed; errors (if any) are user-readable and non-digest.

## Planned Output
- Master Inbox is no longer blocked by Server Action 500s; conversation list loads reliably.

## Planned Handoff
- Phase 117c adds minimal observability so future failures are diagnosable (no digest-only dead ends).

## Output

- Fixed the Inbox launch blocker by eliminating Server Action 500s caused by non-serializable return values and premature/invalid client-side invocation:
  - Server Actions now return wire-safe values (no `Date` objects in payloads for inbox-critical actions).
  - Master Inbox query is gated until workspaces are loaded (prevents `clientId:{}` / `cursor:{}` placeholder calls).
  - Empty-string filters are coerced to `undefined` instead of being cast into the union type.
  - Polling is disabled when unready or in an error state (prevents 30s error loops).
  - Workspace fetch failures now show a visible error + retry instead of silently failing.
  - Server Actions origin allowlisting is configured in an env-driven, custom-domain-safe way (no wildcard allow-all by default).
- Validation:
  - `npm run typecheck` — pass
  - `npm test` — pass
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass

## Handoff

- Phase 117d/117e: deploy and run production smoke tests for Master Inbox (workspace list + single workspace + All Workspaces), then finalize the rollback/runbook updates for this incident class.
