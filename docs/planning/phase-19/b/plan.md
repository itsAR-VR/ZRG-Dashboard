# Phase 19b — Outbound Replies + Campaign Sync Parity

## Focus
Route outbound email replies and email campaign syncing through the selected provider, matching EmailBison behavior.

## Inputs
- Phase 19a provider resolution utilities
- Existing EmailBison reply + campaign sync actions

## Work
- Add provider-specific API clients/wrappers for SmartLead and Instantly.
- Route `sendEmailReply*` through the selected provider.
- Add `syncEmailCampaignsFromSmartLead` and `syncEmailCampaignsFromInstantly`.
- Keep data model stable (reuse `EmailCampaign.bisonCampaignId` for provider campaign ids).

## Output
- Added provider API wrappers:
  - `lib/smartlead-api.ts` (campaign list + reply to email thread)
  - `lib/instantly-api.ts` (campaign list + reply to email)
- Added provider thread handles stored in `Message.emailBisonReplyId`:
  - `lib/email-reply-handle.ts` (`smartlead:` / `instantly:` base64url JSON)
- Routed outbound replies through the active provider:
  - `actions/email-actions.ts` now sends via EmailBison/SmartLead/Instantly based on `resolveEmailIntegrationProvider`
- Added campaign sync parity:
  - `actions/email-campaign-actions.ts` includes `syncEmailCampaignsFromSmartLead` and `syncEmailCampaignsFromInstantly` and gates EmailBison sync by provider.

## Handoff
- Proceed to Phase 19c to add SmartLead webhook ingestion (EMAIL_REPLY/EMAIL_SENT/etc) and persist thread handles needed for replying.
