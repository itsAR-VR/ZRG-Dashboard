# Phase 83b — Schema Skeleton (Prisma)

## Focus
Add database fields/models needed to support the CRM “sheet” rows, pipeline tracking, and sales call metadata — without building full sales workflows yet.

## Inputs
- Phase 83a column list and “editable vs computed” decisions
- Current canonical schema: `prisma/schema.prisma`
- Existing signals: `Lead.sentimentTag`, `Message.sentBy`, `Lead.overallScore`, `Appointment` history

## Work
- Decide persistence strategy:
  - Minimal (fields on `Lead`) vs
  - Dedicated 1:1 “CRM row” model (recommended to avoid bloating `Lead`)
- Proposed skeleton (example direction — finalize in implementation phase):
  - `LeadCrmRow` (1:1 with `Lead`) for:
    - `interestRegisteredAt`, `interestType`, `interestMessageId`, `interestChannel`
    - `interestCampaignSnapshot` (or campaign ids) + `responseMode` (AI vs setter) + `responseSetterUserId`
    - `leadScoreAtInterest`
    - Pipeline fields: stage, value, currency, close status, timestamps
    - Sales call fields: heldAt, outcome, callScore, coachingNotes, recordingUrl (metadata only)
  - Enums for `InterestType`, `PipelineStage`, `CloseStatus` (keep nullable for backwards compat)
- Indexes:
  - Common filters: `(clientId, interestRegisteredAt desc)`, pipeline stage, close status
- Document “skeleton-only” behavior:
  - Fields exist, UI can show them, but no required automation beyond “interest row creation”

## Output

### Schema Skeleton Implemented

- Added **enum** `CrmResponseMode` (`AI`, `HUMAN`, `UNKNOWN`) for AI vs human attribution.
- Added **model** `LeadCrmRow` (1:1 with `Lead`) to store CRM row metadata:
  - Interest snapshot: `interestRegisteredAt`, `interestType`, `interestMessageId`, `interestChannel`, `interestCampaignName`
  - Response attribution: `responseMode`, `responseMessageId`, `responseSentByUserId`
  - Score snapshot: `leadScoreAtInterest`, `leadFitScoreAtInterest`, `leadIntentScoreAtInterest`
  - Manual notes: `notes`
  - Pipeline skeleton: `pipelineStage`, `pipelineStatus`, `pipelineValue`, `pipelineCurrency`, `pipelineOutcome`, `pipelineOutcomeAt`
  - Sales call skeleton: `salesCallHeldAt`, `salesCallOutcome`, `salesCallScore`, `salesCallContext`, `salesCallNotes`, `salesCallImprovementNotes`, `salesCallRecordingUrl`, `salesCallOwnerUserId`, `salesCallReviewedByUserId`
  - Standard timestamps: `createdAt`, `updatedAt`
- Added relation field on `Lead`: `crmRow LeadCrmRow?`
- Indexes for common filters: `interestRegisteredAt`, `interestType`, `responseMode`, `pipelineStage`, `pipelineOutcome`

**Files updated:** `prisma/schema.prisma`

**DB sync:** `npm run db:push` still required once implementation changes are finalized (pending environment access).

## Handoff
Proceed to Phase 83c to define and implement idempotent upsert logic that creates/updates `LeadCrmRow` on positive interest events.
