# Phase 153b — Fix InboxView Message-Load Concurrency (Spinner Stuck)

## Focus
Eliminate the stuck loading spinner in the messaging pane after workspace switches by making `fetchActiveConversation()` concurrency-safe:
- background refreshes must not supersede a foreground/initial load, and
- the foreground load must always be able to clear `isLoadingMessages`.

## Inputs
- Jam `58b1a311-85a0-4246-98af-3f378c148198` symptom: message pane stays blank + spinner until refresh.
- Current implementation: `components/dashboard/inbox-view.tsx`:
  - `fetchActiveConversation(showLoading)` uses `activeConversationRequestRef` to ignore stale results.
  - effects can call `fetchActiveConversation(false)` for background refreshes.
  - a later background call can invalidate the request id for the initial load, preventing it from clearing `isLoadingMessages`.

## Work
1. Pre-flight conflict check:
   - `git status --porcelain`
   - re-read the current `fetchActiveConversation` + related effects in `components/dashboard/inbox-view.tsx`.
2. Add minimal concurrency guards:
   - Track current `activeConversationId` in a ref (`activeConversationIdRef`).
   - Track whether a foreground load is in progress (`isLoadingMessages` in a ref).
   - Ensure background refresh (`showLoading=false`) returns early when a foreground load is active.
3. Adjust request invalidation semantics:
   - Only “supersede” an in-flight request when the conversation id changes or when starting a new *foreground* load.
   - Do not supersede a foreground request id with background refresh calls.
4. Apply results only if still relevant:
   - Before applying fetched messages or clearing `isLoadingMessages`, confirm:
     - selected conversation id is still the one being fetched, and
     - the request sequence matches the latest superseding id for that conversation.
5. Regression checks:
   - Switching workspaces rapidly should not wedge the spinner.
   - Auto-select-first-conversation behavior should still load messages reliably.

## Output
- Implemented in `components/dashboard/inbox-view.tsx`:
  - Added refs: `activeConversationRequestLeadRef`, `activeConversationIdRef`, and `isLoadingMessagesRef`.
  - Updated `fetchActiveConversation(showLoading)` to keep foreground loads authoritative:
    - background refresh returns early while `isLoadingMessages` is active,
    - request superseding now occurs only on lead change or foreground load,
    - result application and loading-state clear are gated by both request id and current selected lead id.
- Spinner-clear path is now protected from silent-refresh invalidation.

## Handoff
Proceed to Phase 153c (now implemented) for URL persistence of manual workspace selection.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Re-read the active conversation fetch path and confirmed the stale-request guard could invalidate foreground completion.
  - Applied minimal guard logic to prevent background fetches from superseding a foreground load.
  - Kept existing optimistic conversation rendering and auto-sync behavior unchanged.
- Commands run:
  - `sed -n '430,660p' components/dashboard/inbox-view.tsx` — inspected fetch logic before edit.
  - `rg -n "fetchActiveConversation|isLoadingMessagesRef|activeConversationRequestLeadRef" components/dashboard/inbox-view.tsx` — verified new guards were present.
- Blockers:
  - None for this subphase.
- Next concrete steps:
  - Complete subphase 153c and run full subphase 153d validations.
