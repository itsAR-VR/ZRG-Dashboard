# Phase 4a — Confirm Payload Shape + Harden Webhook Extraction + Auto-Create

## Focus
Make the inbound GHL SMS webhook reliably extract the SMS sub-client label (even if the upstream field name differs by workspace) and always upsert/link `SmsCampaign` for that workspace.

## Inputs
- Real webhook payload samples from:
  - Uday 18th workspace (known failure)
  - Owen workspace (for parity)
- Code:
  - `app/api/webhooks/ghl/sms/route.ts`
  - `lib/sms-campaign.ts` (`normalizeSmsCampaignLabel()`)
  - `lib/lead-matching.ts` (`findOrCreateLead()` campaignIds behavior)

## Work
1. **Confirm where the label actually lives**
   - Identify the exact field path(s) in the inbound payload that contain the label (e.g., `customData.Client`, `customData["Client Name"]`, `triggerData.*`, etc.).
   - Confirm type (string vs object) and casing/spacing of keys.

2. **Implement a single extraction helper**
   - Add a helper in the webhook route (or a small utility in `lib/`) that:
     - Checks a prioritized list of candidate keys.
     - Coerces non-string values safely when possible.
     - Returns `normalizeSmsCampaignLabel(...)` output.

3. **Upsert + link**
   - If a normalized label exists, `upsert` `SmsCampaign` under the workspace.
   - Pass `smsCampaignId` into `findOrCreateLead(...)` so:
     - new leads are linked
     - existing leads get linked only when `Lead.smsCampaignId` is currently null

4. **Add safe diagnostics**
   - When no label is found, log:
     - `clientId`, `locationId`, `contactId`
     - available `customData` keys (not values)
   - Avoid printing phone/email/message body.

5. **Local test path**
   - Use `/api/webhooks/ghl/test` to simulate payload variants discovered in Uday/Owen (may require extending the test endpoint to allow alternate key names).

## Output
- Webhook handler reliably finds and normalizes the SMS sub-client label for Uday/Owen payloads.
- New labels auto-create `SmsCampaign` rows and future leads are attributed.

## Handoff
Once the extractor is stable, implement the backfill (Phase 4b) using the same normalization rules so historical leads are consistent with new ingestion.
