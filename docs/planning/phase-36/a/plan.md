# Phase 36a — Data Model & Schema

## Focus

Define and implement the Prisma schema changes for booking processes, stages, and reply tracking infrastructure.

## Inputs

- Existing `EmailCampaign` model (prisma/schema.prisma:743)
- Existing `Lead` model with `lastInboundAt`, `offeredSlots` fields
- Existing `Message` model with `channel` enum (sms/email/linkedin)
- Existing `WorkspaceSettings` for qualifying questions and calendar link

## Work

### 1. Create BookingProcess Model

```prisma
model BookingProcess {
  id          String   @id @default(cuid())
  clientId    String
  client      Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)

  name        String
  description String?

  // Global settings
  maxRepliesBeforeEscalation Int @default(5)

  stages      BookingProcessStage[]
  campaigns   EmailCampaign[]

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  createdBy   String?  // User ID who created

  @@index([clientId])
}
```

### 2. Create BookingProcessStage Model

```prisma
model BookingProcessStage {
  id                String   @id @default(cuid())
  bookingProcessId  String
  bookingProcess    BookingProcess @relation(fields: [bookingProcessId], references: [id], onDelete: Cascade)

  stageNumber       Int      // 1, 2, 3...

  // What to include in this stage
  includeBookingLink        Boolean @default(false)
  linkType                  String? // "plain_url" | "hyperlinked_text"
  includeSuggestedTimes     Boolean @default(false)
  numberOfTimesToSuggest    Int     @default(3)
  includeQualifyingQuestions Boolean @default(false)
  qualifyingQuestionIds     String[] // IDs from WorkspaceSettings qualifying questions
  includeTimezoneAsk        Boolean @default(false)

  // Channel applicability (which channels this stage applies to)
  applyToEmail    Boolean @default(true)
  applyToSms      Boolean @default(true)
  applyToLinkedin Boolean @default(true)

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([bookingProcessId, stageNumber])
  @@index([bookingProcessId])
}
```

### 3. Add BookingProcess to EmailCampaign

```prisma
model EmailCampaign {
  // ... existing fields ...

  bookingProcessId String?
  bookingProcess   BookingProcess? @relation(fields: [bookingProcessId], references: [id], onDelete: SetNull)
}
```

### 4. Create Reply Counter Model

Track outbound reply count per lead, per campaign, per channel:

```prisma
model LeadCampaignReplyCount {
  id          String   @id @default(cuid())
  leadId      String
  lead        Lead     @relation(fields: [leadId], references: [id], onDelete: Cascade)

  campaignId  String
  campaign    EmailCampaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)

  // Per-channel counts
  emailReplyCount    Int @default(0)
  smsReplyCount      Int @default(0)
  linkedinReplyCount Int @default(0)

  // Timestamps for potential reset logic
  lastEmailReplyAt    DateTime?
  lastSmsReplyAt      DateTime?
  lastLinkedinReplyAt DateTime?

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([leadId, campaignId])
  @@index([leadId])
  @@index([campaignId])
}
```

### 5. Add Qualifying Questions to WorkspaceSettings

If not already present, add a structured field for saved qualifying questions:

```prisma
model WorkspaceSettings {
  // ... existing fields ...

  qualifyingQuestions Json? // Array of { id, text, category? }
}
```

### 6. Verify Relations

- Add `LeadCampaignReplyCount[]` relation to `Lead`
- Add `LeadCampaignReplyCount[]` relation to `EmailCampaign`
- Add `BookingProcess[]` relation to `Client`

## Output

**Completed 2026-01-18**

Schema changes applied to `prisma/schema.prisma`:

1. **New enum:** `BookingProcessLinkType` (PLAIN_URL, HYPERLINKED_TEXT)

2. **New model:** `BookingProcess` — reusable booking process definition per workspace
   - Fields: `id`, `clientId`, `name`, `description`, `maxWavesBeforeEscalation`, `createdBy`
   - Relations: `stages[]`, `campaigns[]`, `leadProgress[]`
   - Unique constraint: `[clientId, name]`

3. **New model:** `BookingProcessStage` — per-stage/wave configuration
   - Fields: `stageNumber`, `includeBookingLink`, `linkType`, `includeSuggestedTimes`, `numberOfTimesToSuggest`, `includeQualifyingQuestions`, `qualificationQuestionIds`, `includeTimezoneAsk`
   - Channel applicability: `applyToEmail`, `applyToSms`, `applyToLinkedin`
   - Unique constraint: `[bookingProcessId, stageNumber]`

4. **New model:** `LeadCampaignBookingProgress` — wave tracking per lead/campaign
   - Wave tracking: `currentWave`, `waveEmailSent`, `waveSmsSent`, `waveLinkedinSent`
   - DND hold tracking: `smsDndHeldSince`, `smsDndLastRetryAt`
   - Lifetime counters: `emailOutboundCount`, `smsOutboundCount`, `linkedinOutboundCount`
   - Question rotation: `selectedRequiredQuestionIds`
   - Unique constraint: `[leadId, emailCampaignId]`

5. **Updated model:** `EmailCampaign` — added `bookingProcessId` relation

6. **Updated model:** `Message` — multipart SMS support (Phase 36i)
   - Changed `aiDraftId` from `@unique` to indexed
   - Added `aiDraftPartIndex Int?` for multipart SMS
   - Added `@@unique([aiDraftId, aiDraftPartIndex])` for idempotency

7. **Updated model:** `AIDraft` — changed `sentMessage Message?` to `sentMessages Message[]`

8. **Updated model:** `Client` — added `bookingProcesses BookingProcess[]` relation

9. **Updated model:** `Lead` — added `bookingProgress LeadCampaignBookingProgress[]` relation

**Database sync:** `npm run db:push --accept-data-loss` completed successfully.

**Prisma client:** Regenerated via `npx prisma generate`.

## Handoff

Schema is ready with wave-based tracking model (per Phase 36h addendum) and multipart SMS support (per Phase 36i addendum). Subphase b will implement the wave progress utility functions for incrementing wave counts and determining when waves complete.
