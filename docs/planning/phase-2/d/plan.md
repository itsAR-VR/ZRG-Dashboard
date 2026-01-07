# Phase 2d — Fix: webhook/cron-safe sync (no `requireAuthUser`, no UI revalidate)

## Focus
Make conversation-history sync paths safe to run from webhooks/cron by removing assumptions about an end-user Supabase session and eliminating UI cache invalidation from background jobs.

## Inputs
- Phase 2a decisions on “system context” vs “user context”
- Relevant code:
  - `app/api/webhooks/ghl/sms/route.ts` (calls `syncConversationHistory(lead.id)` fire-and-forget)
  - `actions/message-actions.ts`:
    - `syncConversationHistory()` / `syncEmailConversationHistory()` (currently call `requireLeadAccess()` + `revalidatePath("/")`)
    - `approveAndSendDraft()` (requires `requireAuthUser()`; relevant if webhook auto-reply is enabled)
  - `lib/workspace-access.ts` (`requireAuthUser()` always expects cookies/session)

## Work
- Split “core sync logic” from “UI/server-action wrapper”:
  - Extract a `lib/*` sync helper that takes `leadId` (and required credentials via DB) and performs:
    - fetch → import/heal → rollups → sentiment refresh (if needed)
  - Keep `actions/*` functions as thin wrappers that:
    - enforce user authorization
    - call the core helper
    - perform UI revalidation only when appropriate
- Update webhook and cron call sites to use the core helper directly (no `requireAuthUser()`).
- Decide how webhook-triggered auto-reply should send (if in scope):
  - Either: keep auto-reply sending out of webhook until a safe “system send” path exists
  - Or: add an explicit, secret-gated system send path that does not depend on a user session
- Ensure any “fire-and-forget” background invocation does not call `revalidatePath`.

## Output
- Webhook/cron-safe “system” sync helpers extracted and used in automation paths:
  - Added `lib/conversation-sync.ts` with:
    - `syncSmsConversationHistorySystem()` (no Supabase user session, no `revalidatePath`)
    - `syncEmailConversationHistorySystem()` (no Supabase user session, no `revalidatePath`)
    - Shared, system-safe sentiment refresh behavior (same policy as UI: keeps rollups in sync, rejects drafts when sentiment isn’t eligible, clears pending enrichment when sentiment turns non-positive).
  - Refactored Server Actions to be thin wrappers:
    - `actions/message-actions.ts` `syncConversationHistory()` now does `requireLeadAccess()` then delegates to `syncSmsConversationHistorySystem()`.
    - `actions/message-actions.ts` `syncEmailConversationHistory()` now does `requireLeadAccess()` then delegates to `syncEmailConversationHistorySystem()`.
  - Updated background email send path to avoid user-auth + revalidation assumptions:
    - `actions/email-actions.ts` now calls `syncEmailConversationHistorySystem()` fire-and-forget instead of the user-authenticated Server Action.

Result: automation/background sync no longer depends on Supabase session cookies and no longer triggers UI cache invalidation from background jobs.

## Handoff
Proceed to Phase 2e to verify there are no remaining `revalidatePath("/")` calls in any background/automation paths, and run targeted regression checks (cron followups, availability refresh, sync, lint/build).
