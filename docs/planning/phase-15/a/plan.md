# Phase 15a — Server Actions for Campaign Config

## Focus
Expose safe, admin-scoped server actions to read and update `EmailCampaign.responseMode` and `EmailCampaign.autoSendConfidenceThreshold`.

## Inputs
- Prisma: `EmailCampaign.responseMode`, `EmailCampaign.autoSendConfidenceThreshold`
- Existing actions: `actions/email-campaign-actions.ts` (`getEmailCampaigns`, `syncEmailCampaignsFromEmailBison`)
- Access control: `requireClientAdminAccess`

## Work
- Extend `getEmailCampaigns()` to include `responseMode` and `autoSendConfidenceThreshold` in its returned data.
- Add `updateEmailCampaignConfig(emailCampaignId, { responseMode, autoSendConfidenceThreshold })`:
  - Load campaign → verify admin access for owning client.
  - Validate threshold (clamp to 0..1; default 0.9 if missing when needed).
  - Update DB and `revalidatePath("/")`.

## Output
- Server actions available for UI to fetch/update campaign assignment config.

## Handoff
Phase 15b consumes these actions to render and save settings from the client UI.

