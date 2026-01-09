# Phase 8b — Always-on Resolve/Hydrate in Sync Flows + Rate-Limit Tuning

## Focus
Make “Sync” (single lead) and “Sync All” (workspace) always attempt to resolve missing `ghlContactId` (by searching GHL via email) and hydrate missing lead fields from GHL, while increasing throughput up to documented GHL limits.

## Inputs
- Sync entrypoints:
  - Single-lead: `actions/message-actions.ts` (`smartSyncConversation`)
  - Batch: `actions/message-actions.ts` (`syncAllConversations`)
- Resolver/hydration:
  - `lib/ghl-contacts.ts` (`ensureGhlContactIdForLead`)
  - `lib/conversation-sync.ts` (SMS sync + lead hydration)
  - `app/api/webhooks/ghl/sms/route.ts` (payload hydration)
- Rate limits (GHL API 2.0):
  - Burst: **100 requests / 10 seconds**
  - Daily: **200,000 requests / day** per location/company
  - Handle `429` using `Retry-After` backoff

## Work
1. Remove the “batch disables GHL resolution” behavior:
   - Ensure `syncAllConversations` does not pass `resolveMissingGhlContactId: false` into `smartSyncConversation`.
2. Define the “resolve missing GHL contact” policy for sync:
   - Prefer **search/link** by email (`POST /contacts/search`) before any create/upsert.
   - If business rules allow creation for a class of leads (e.g., EmailBison positive leads already do), document and enforce that gating explicitly.
3. Implement a per-location rate limiter:
   - Documented limits: **100 requests / 10 seconds burst** per location/company; **200,000 requests / day**.
   - Target utilization: ~80–90% of burst (buffer) → cap at **80–90 requests per 10 seconds** per `ghlLocationId`.
   - Centralize this inside `lib/ghl-api.ts` request wrapper so all call sites benefit.
   - On `429`, honor `Retry-After` (seconds) and retry with jitter.
4. Increase concurrency in `syncAllConversations` safely:
   - Current concurrency is a fixed batch size; increase it while the rate limiter enforces the true limit.
   - Ensure the function remains stable under high lead counts (no unbounded memory growth; process in pages/batches).
5. Ensure results clearly surface “contact updated” outcomes even when no messages import:
   - Preserve/expand `leadUpdated` plumbing in sync result objects.
6. Reduce unnecessary GHL calls (speed wins):
   - When `POST /contacts/search` returns a contact with the needed standard fields, hydrate directly from that payload (avoid an extra `GET /contacts/{id}` unless required).
   - Avoid repeated “hydrate” calls during a single run (in-memory cache per lead/contact within a batch is OK).

## Output
- “Sync” and “Sync All” always perform GHL resolve/hydrate.
- Batch throughput is higher but stays within GHL limits and handles 429s reliably.

## Handoff
Build and run a resumable global backfill across all clients/leads in Phase 8c.

### Completed Changes
- Always-on GHL contact resolution for sync (search/link only):
  - Added `resolveGhlContactIdForLead` (no create/upsert) in `lib/ghl-contacts.ts`.
  - Updated `smartSyncConversation` to always call the resolver when `ghlContactId` is missing, then sync SMS if resolved: `actions/message-actions.ts`.
- “Sync All” no longer disables resolution:
  - Removed `resolveMissingGhlContactId: false` override and always uses the same sync behavior as single-lead sync: `actions/message-actions.ts`.
- Higher throughput with guardrails:
  - Increased batch concurrency default to 15 (override via `SYNC_ALL_CONCURRENCY`): `actions/message-actions.ts`.
  - Added centralized GHL throttling + 429 retry handling (honors `Retry-After` + jitter) in `lib/ghl-api.ts`.
  - Default throttle targets ~90 requests / 10s (override via `GHL_REQUESTS_PER_10S`).
- Reduced “accidental create” risk:
  - When an existing contact is found by search, `ensureGhlContactIdForLead` now uses update-by-id (PUT) instead of upsert, avoiding duplicate-creation behavior in permissive locations: `lib/ghl-contacts.ts`.
- PII-safety improvements (GHL client):
  - Removed raw error-body logging and redacts common PII patterns in error messages: `lib/ghl-api.ts`.

### Handoff Notes For 8c
- Prefer the new resolver (search/link only) for backfill; avoid calling `ensureGhlContactIdForLead` in backfill unless explicitly opting into contact creation.
- Use the centralized rate limiter in `lib/ghl-api.ts` (already applied to `contacts/search`, contact create/upsert, export messages, calendars/users/workflows).
