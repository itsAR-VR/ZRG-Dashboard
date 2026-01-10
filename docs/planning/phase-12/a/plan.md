# Phase 12a — Data Model + Campaign Config Defaults

## Focus
Add the DB fields/enums needed to support per-campaign response modes (setter-managed vs AI auto-send), AI-vs-setter outbound tracking, and provider-aware booking inputs (without hardcoding GHL).

## Inputs
- `prisma/schema.prisma` (canonical data model)
- Existing EmailBison campaign sync code (search keys: `EmailCampaign`, `bisonCampaignId`, `syncEmailCampaignsFromEmailBison`)
- Existing message/outbound message model(s) used for replies
- Existing workspace settings model (includes or should include booking provider fields)

## Work
- Add per-campaign config:
  - `responseMode: SETTER_MANAGED | AI_AUTO_SEND` (default `SETTER_MANAGED`)
  - `autoSendConfidenceThreshold: Float` (default `0.90`)
- Ensure sync sets defaults on newly discovered campaigns without overwriting explicit overrides.
- Add outbound tracking fields:
  - `sentBy: "ai" | "setter" | null` on the outbound message row (or the unified `Message` table if that represents outbound)
  - Optional: `aiDraftId` when an outbound message was sent from a draft
- Confirm/standardize the lead booking fields used by provider-aware logic:
  - GHL: `lead.ghlAppointmentId` (or canonical equivalent)
  - Calendly: `lead.calendlyInviteeUri` / scheduled-event URI (already stored by recent Calendly work)
- Run Prisma schema sync (`npm run db:push`) against the correct database when implementing.

## Output
- Updated Prisma schema:
  - Added `CampaignResponseMode` enum
  - `EmailCampaign.responseMode` (default `SETTER_MANAGED`)
  - `EmailCampaign.autoSendConfidenceThreshold` (default `0.9`)
  - `Message.sentBy` (`'ai' | 'setter'`, outbound only)
  - `Message.aiDraftId` (optional, unique) + relation to `AIDraft`
  - `AIDraft.sentMessage` backrelation
- Regenerated Prisma client via `npx prisma generate`
- Attempted `npx prisma db push --accept-data-loss` but DB was unreachable from this environment (P1001); rerun locally when network/DB access is available.

## Handoff
Subphase 12b can rely on:
- `campaign.responseMode` and `campaign.autoSendConfidenceThreshold` for routing (setter vs AI auto-send)
- `Message.sentBy` + `Message.aiDraftId` to persist AI-vs-setter attribution when sending from drafts.
