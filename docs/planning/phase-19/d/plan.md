# Phase 19d — Instantly Webhooks (Ingestion + Dedupe)

## Focus
Ingest Instantly webhook events into the unified inbox, matching EmailBison behavior where possible.

## Inputs
- Phase 19a provider selection + workspace configuration
- Instantly webhook + API docs

## Work
- Add `POST /api/webhooks/instantly?clientId=...` route.
- Validate per-workspace `instantlyWebhookSecret` (via Authorization/custom header).
- Handle at least:
  - `reply_received` → create inbound email `Message`, run sentiment + draft generation, pause follow-ups, etc.
  - `email_sent` → create outbound `Message` (campaign), start no-response follow-ups.
  - `unsubscribed` → blacklist lead + reject drafts.
- Dedupe webhook retries via unique Message keys.

## Output
- Added Instantly webhook endpoint:
  - `app/api/webhooks/instantly/route.ts` (`reply_received`, `email_sent`, `unsubscribed`)
- Security + routing:
  - Requires `clientId` query param
  - Validates per-workspace `instantlyWebhookSecret` via Authorization header (`Bearer <secret>`) or `x-instantly-secret`
  - Ignores requests if workspace email provider is not `INSTANTLY`
- Ingestion behavior:
  - Replies create inbound `Message(channel="email")`, update lead sentiment/status, generate draft, and optionally auto-send if campaign is `AI_AUTO_SEND`
  - Sent events create outbound `Message` (campaign) and kick off no-response follow-ups
  - Unsubscribe events blacklist the lead and reject pending drafts
- Reply threading:
  - Stores Instantly reply handle in `Message.emailBisonReplyId` with an `instantly:` prefix (includes timestamp for uniqueness while remaining decodable for replies).

## Handoff
- Proceed to Phase 19e to update the Settings UI and README for provider selection, webhook URLs, and provider-specific campaign syncing.
