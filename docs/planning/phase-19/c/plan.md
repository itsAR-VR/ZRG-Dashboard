# Phase 19c — SmartLead Webhooks (Ingestion + Dedupe)

## Focus
Ingest SmartLead webhook events into the unified inbox, matching EmailBison behavior where possible.

## Inputs
- Phase 19a provider selection + workspace configuration
- Email webhook ingestion behavior (`app/api/webhooks/email/route.ts`)
- SmartLead webhook + API docs

## Work
- Add `POST /api/webhooks/smartlead?clientId=...` route.
- Validate per-workspace `smartLeadWebhookSecret`.
- Handle at least:
  - `EMAIL_REPLY` → create inbound email `Message`, run sentiment + draft generation, pause follow-ups, etc.
  - `EMAIL_SENT` → create outbound `Message` (campaign), start no-response follow-ups.
  - `LEAD_UNSUBSCRIBED` (if available) → blacklist lead + reject drafts.
- Dedupe webhook retries via unique Message keys.

## Output
- Added SmartLead webhook endpoint:
  - `app/api/webhooks/smartlead/route.ts` (`EMAIL_REPLY`, `EMAIL_SENT`, `LEAD_UNSUBSCRIBED`)
- Security + routing:
  - Requires `clientId` query param
  - Validates per-workspace `smartLeadWebhookSecret` via Authorization header, `x-smartlead-secret`, or payload `secret_key`
  - Ignores requests if workspace email provider is not `SMARTLEAD`
- Ingestion behavior:
  - Replies create inbound `Message(channel="email")`, update lead sentiment/status, generate draft, and optionally auto-send if campaign is `AI_AUTO_SEND`
  - Sent events create outbound `Message` (campaign) and kick off no-response follow-ups
  - Unsubscribe events blacklist the lead and reject pending drafts

## Handoff
- Proceed to Phase 19d to add the Instantly webhook endpoint with similar ingestion + dedupe semantics and reply handle storage.
