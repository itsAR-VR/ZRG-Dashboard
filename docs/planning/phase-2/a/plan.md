# Phase 2a — Triage: map logs → code paths + desired behavior

## Focus
Turn the four production log signatures into concrete, testable code changes by locating the exact call sites and deciding what “correct” behavior should be (retry vs skip vs pause).

## Inputs
- `ZRG Dashboard Logs (11).json` (the four extracted log entries)
- Code pointers already identified:
  - DND failures: `lib/followup-engine.ts` → `sendMessage()` → `lib/ghl-api.ts`
  - Missing calendar link: `lib/availability-cache.ts` (`refreshAvailabilityCachesDue`, `refreshWorkspaceAvailabilityCache`)
  - Webhook auth failure: `app/api/webhooks/ghl/sms/route.ts` calls `actions/message-actions.ts` `syncConversationHistory()`
  - `revalidatePath` runtime error: `actions/message-actions.ts` `syncEmailConversationHistory()` / `syncConversationHistory()` call `revalidatePath("/")`

## Work
- Confirm exact error propagation paths and current behavior:
  - Where `GHL API error: 400 - ...DND...` is surfaced (string matching vs structured error).
  - How `refreshAvailabilityCachesDue()` selects clients and why “no default calendar link” repeats every cron run.
  - Where webhook invokes server actions that depend on `requireAuthUser()` and why they fail silently (log-only).
  - Identify all `revalidatePath("/")` call sites in background/automation paths.
- Decide “desired behavior” for each error:
  - SMS DND: treat as permanent skip for SMS steps; decide whether to pause the sequence, advance past SMS steps, and/or notify.
  - Missing calendar link: treat as “unconfigured”, not an operational error; decide on backoff/skip semantics.
  - Webhook sync: must run without end-user auth; decide on “system context” execution approach.
  - Revalidation: decide whether to remove `revalidatePath` from sync helpers and keep it only in user-initiated actions.
- Define acceptance checks (manual or automated) per fix:
  - Follow-up cron run with a DND contact results in `skipped` (not `failed`) and does not retry.
  - Availability refresh reports `skippedNoDefault` (or similar) and stops repeating errors.
  - Webhook processing triggers sync without `Not authenticated` logs.
  - Email sync no longer throws `revalidatePath` runtime errors.

## Output
- Decision record (implementation targets + behavior)
  - **SMS DND (GHL 400 / “DND is active for SMS”)**
    - Observed log source: `lib/ghl-api.ts` `ghlRequest()` logs `GHL API error (400): {\"status\":400,\"message\":\"Cannot send message as DND is active for SMS.\"...}`
    - Propagation: `actions/message-actions.ts` `sendMessage()` returns `success:false` with `error` string; `lib/followup-engine.ts` treats it as hard failure (non-phone errors).
    - Desired behavior: treat as **non-retryable** for SMS steps; mark step **skipped + advance** so cron does not retry indefinitely.
    - Detection mechanism: add **structured error classification** in `lib/ghl-api.ts` by parsing the JSON error payload and surfacing a stable `errorCode` (fallback to substring match on the extracted `message`).
    - Logging: `console.log` (not `console.error`) once per step execution: `"[FollowUp] SMS skipped (DND) for lead {id}"`.
    - Visibility: create `FollowUpTask(status="skipped")` for SMS steps that were skipped due to DND (so operators can see what happened).

  - **Availability refresh: “No default calendar link configured”**
    - Observed log source: `lib/availability-cache.ts` `refreshWorkspaceAvailabilityCache()` returns `{ success:false, error:"No default calendar link configured" }`.
    - Propagation: `refreshAvailabilityCachesDue()` aggregates errors and `/api/cron/followups` logs them repeatedly every TTL window.
    - Desired behavior: treat as **unconfigured (skipped)**, not operational error; still write an empty cache row for SSR safety.
    - Scheduling: back off refresh attempts for unconfigured workspaces by setting `staleAt` far in the future (but still refresh immediately when a default calendar link is added/changed).
    - Cron output: add explicit counters like `skippedNoDefault` and remove these entries from `errors[]`.

  - **Webhook-triggered sync: “Error: Not authenticated”**
    - Observed log source: `/api/webhooks/ghl/sms` calls `actions/message-actions.ts` `syncConversationHistory()` fire-and-forget.
    - Root cause: `syncConversationHistory()` begins with `requireLeadAccess()` which depends on Supabase user session/cookies (not present in webhook context).
    - Desired behavior: sync should be runnable in a **system context** (leadId + workspace credentials from DB), without any user session.
    - Implementation: extract a **core sync helper** into `lib/` (system-safe, no `requireLeadAccess`, no `revalidatePath`) and have:
      - Server Actions wrap it with auth checks + UI revalidation
      - Webhooks/cron call the core helper directly
    - Logging: keep `[Sync] ...` logs, but avoid any PII beyond leadId/contactId.

  - **`revalidatePath("/")` runtime errors**
    - Observed log source: `actions/message-actions.ts` `syncEmailConversationHistory()` throws when `revalidatePath("/")` runs in an unsupported context (background / render / cached function).
    - Root cause: sync helpers are used in “fire-and-forget” contexts (e.g., `actions/email-actions.ts` triggers background email sync) but still call `revalidatePath("/")`.
    - Desired behavior: remove `revalidatePath` from core sync helpers and make cache invalidation **caller-owned**, only in user-initiated server actions.
    - Implementation: core sync returns results; UI actions do `revalidatePath("/")` after awaiting sync; background/webhook paths never call it.
    - Logging: treat revalidation issues as code bugs; after fix there should be no new occurrences in logs.

## Handoff
Proceed to Phase 2b implementing:
- `lib/ghl-api.ts`: parse error payload + surface a stable DND classification
- `lib/followup-engine.ts`: treat DND failures as `skipped` + `advance: true` and (optionally) persist `FollowUpTask(status="skipped")` for visibility.
