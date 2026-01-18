# Phase 36b — Reply Counter Implementation

## Focus

Implement the logic to track and increment outbound reply counts per lead, per campaign, per channel whenever the AI sends a message.

## Inputs

- `LeadCampaignReplyCount` model from phase 36a
- Existing message sending flows:
  - Email: `lib/emailbison-api.ts` send functions
  - SMS: `lib/ghl-api.ts` send functions
  - LinkedIn: `lib/unipile-api.ts` send functions
- Webhook handlers that process outbound confirmations

## Work

### 1. Create Reply Counter Utility

Create `lib/reply-counter.ts`:

```typescript
export async function incrementReplyCount(params: {
  leadId: string;
  campaignId: string;
  channel: 'email' | 'sms' | 'linkedin';
}): Promise<void> {
  const { leadId, campaignId, channel } = params;

  const fieldMap = {
    email: { count: 'emailReplyCount', timestamp: 'lastEmailReplyAt' },
    sms: { count: 'smsReplyCount', timestamp: 'lastSmsReplyAt' },
    linkedin: { count: 'linkedinReplyCount', timestamp: 'lastLinkedinReplyAt' },
  };

  const field = fieldMap[channel];

  await prisma.leadCampaignReplyCount.upsert({
    where: {
      leadId_campaignId: { leadId, campaignId },
    },
    create: {
      leadId,
      campaignId,
      [field.count]: 1,
      [field.timestamp]: new Date(),
    },
    update: {
      [field.count]: { increment: 1 },
      [field.timestamp]: new Date(),
    },
  });
}

export async function getReplyCount(params: {
  leadId: string;
  campaignId: string;
  channel: 'email' | 'sms' | 'linkedin';
}): Promise<number> {
  const { leadId, campaignId, channel } = params;

  const record = await prisma.leadCampaignReplyCount.findUnique({
    where: {
      leadId_campaignId: { leadId, campaignId },
    },
  });

  if (!record) return 0;

  const fieldMap = {
    email: 'emailReplyCount',
    sms: 'smsReplyCount',
    linkedin: 'linkedinReplyCount',
  };

  return record[fieldMap[channel]] ?? 0;
}

export async function getAllReplyCounts(params: {
  leadId: string;
  campaignId: string;
}): Promise<{
  email: number;
  sms: number;
  linkedin: number;
}> {
  const record = await prisma.leadCampaignReplyCount.findUnique({
    where: {
      leadId_campaignId: { leadId, campaignId },
    },
  });

  return {
    email: record?.emailReplyCount ?? 0,
    sms: record?.smsReplyCount ?? 0,
    linkedin: record?.linkedinReplyCount ?? 0,
  };
}
```

### 2. Integrate Counter into Send Flows

Identify all places where outbound messages are sent and add counter increment:

**Email sends:**
- `lib/emailbison-api.ts` → after successful send
- `actions/message-actions.ts` → `sendMessage` action
- `lib/followup-engine.ts` → sequence step execution

**SMS sends:**
- `lib/ghl-api.ts` → after successful send
- `actions/message-actions.ts` → `sendMessage` action
- `lib/followup-engine.ts` → sequence step execution

**LinkedIn sends:**
- `lib/unipile-api.ts` → after successful send
- `actions/message-actions.ts` → `sendMessage` action

### 3. Handle Campaign Context

For reply counting to work, we need the `campaignId` available at send time:

- Email messages already have `emailCampaignId` on Message model
- For SMS/LinkedIn, need to trace back to campaign via Lead's source or explicit linking

**Decision point:** If a lead came in via Email Bison campaign but we're replying via SMS, which campaign does the SMS reply count against?

**Proposed solution:**
- Primary campaign = the campaign that sourced the lead (`Lead.emailCampaignId` or similar)
- Track against primary campaign regardless of reply channel
- This aligns with "same lead, different booking process across channels"

### 4. Add Campaign Tracking to Lead

If not already present:

```prisma
model Lead {
  // ... existing fields ...

  primaryCampaignId String?
  primaryCampaign   EmailCampaign? @relation("PrimaryLead", fields: [primaryCampaignId], references: [id])
}
```

Populate this when lead is created from EmailBison webhook.

### 5. Counter Increment Locations

| Location | When to increment |
|----------|-------------------|
| `sendMessage` action | When `source: 'zrg'` (AI-generated) or `source: 'manual'` message is sent |
| `followup-engine.ts` | When follow-up step sends a message |
| Auto-send flows | When auto-reply gate approves and sends |

**Important:** Only count outbound messages from ZRG (AI or manual), not echoed sends from external platforms.

## Output

**Completed 2026-01-18**

> **NOTE:** This subphase was updated to implement wave-based progress tracking per Phase 36h addendum, replacing the original per-channel reply counter design.

Created `lib/booking-progress.ts` with wave-based progress utilities:

### Core Functions

1. **`getOrCreateBookingProgress()`** — Get or create progress row for lead/campaign
   - Freezes `activeBookingProcessId` from campaign on first access
   - Returns progress with included booking process and stages

2. **`getCurrentBookingStage()`** — Get the current stage for a lead based on wave number
   - Returns stage matching `currentWave`, or last stage if past defined stages

3. **`isChannelSendable()`** — Check if lead has required contact info for a channel
   - Email: has `email`
   - SMS: has `phone`
   - LinkedIn: has `linkedinId` or `linkedinUrl`

4. **`isChannelEnabledForStage()`** — Check if channel is enabled in stage config

5. **`recordChannelSend()`** — Record outbound message send
   - Increments channel outbound count (supports multipart SMS count)
   - Marks wave channel as sent
   - Checks if wave is complete and advances if so
   - Clears SMS DND hold on successful send
   - Returns `{ progress, waveAdvanced }`

6. **`skipChannelForWave()`** — Mark channel as skipped (no contact info)
   - Allows wave to advance without that channel

### SMS DND Handling (Phase 36i)

7. **`holdWaveForSmsDnd()`** — Set DND hold timestamp
   - Holds wave until DND clears or 72h timeout

8. **`checkSmsDndTimeout()`** — Check if 72h timeout exceeded
   - If timeout, marks SMS as skipped so wave can advance

9. **`getSmsDndRetryDueLeads()`** — Get leads due for SMS DND retry (every 2h)
   - For cron job to process

### Analytics & Escalation

10. **`shouldEscalateForMaxWaves()`** — Check if lead exceeded max waves
    - Returns true if `currentWave > maxWavesBeforeEscalation`

11. **`storeSelectedRequiredQuestions()`** — Store selected question IDs for attribution

### Integration Points (to be wired in Phase 36e)

The following send flows need to call `recordChannelSend()` after successful outbound Message creation:
- `actions/message-actions.ts` — `approveAndSendDraftSystem()`
- `lib/followup-engine.ts` — sequence step execution
- Auto-send flows in webhook handlers

## Handoff

Wave progress utilities are implemented. Subphase c will build the booking process builder UI. Subphase e will:
1. Use `getCurrentBookingStage()` to determine stage instructions for draft generation
2. Wire `recordChannelSend()` into send flows for progress tracking
