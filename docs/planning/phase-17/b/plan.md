# Phase 17b — Harden GHL SMS Sync (Timeouts + Fallback Paths)

## Focus
Make SMS sync resilient when GHL export results are stale/lagging and when fetch calls hang long enough to contribute to Vercel timeouts.

## Inputs
- `lib/ghl-api.ts` (GHL client)
- `lib/conversation-sync.ts` (system SMS sync)
- `app/api/webhooks/ghl/sms/route.ts` (webhook ingestion + backfill)

## Work
1. Added AbortController timeouts and bounded GET retries in `lib/ghl-api.ts` `ghlRequest()`.
2. Implemented SMS sync strategy:
   - For leads that already have SMS messages, prefer `getConversationByContact` + `getConversationMessages` (fresher).
   - For leads with no SMS history, use export (bounded pages) and merge with conversation messages when export appears stale.
3. Made healing/dedupe safer by using a ±60s sentAt window when matching webhook-created “no ghlId yet” rows.
4. Updated webhook history fetch to use `exportMessages()` (inherits timeouts) and prevented duplicate inserts on webhook retries (±60s window).

## Output
- GHL request timeouts + retry guardrails: `lib/ghl-api.ts`
  - New env knobs: `GHL_FETCH_TIMEOUT_MS`, `GHL_MAX_NETWORK_RETRIES`
  - Export pagination knobs: `GHL_EXPORT_MAX_PAGES`, `GHL_EXPORT_MAX_MESSAGES`
- Fresher SMS sync with conversation fallback: `lib/conversation-sync.ts`
- Webhook import dedupe tightened: `app/api/webhooks/ghl/sms/route.ts`
- Verified build: `npm run build`.

## Handoff
Proceed to Phase 17c to make “Sync All” chunked/resumable to avoid 300s server-action timeouts.

