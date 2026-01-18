# Phase 35c — LinkedIn Webhook Refactor

## Focus

Refactor the LinkedIn (Unipile) webhook to follow the background job pattern, moving AI sentiment analysis, draft generation, and Clay enrichment to an async `LINKEDIN_INBOUND_POST_PROCESS` job handler. Also enqueue a separate `LEAD_SCORING_POST_PROCESS` job for each inbound message (do not score inline).

## Inputs

- Phase 35b output: SMS webhook successfully refactored, pattern established
- Current implementation: `app/api/webhooks/linkedin/route.ts`
- Reference pattern: `lib/background-jobs/sms-inbound-post-process.ts`

## Work

### 1. Create LinkedIn Background Job Handler

**Create `lib/background-jobs/linkedin-inbound-post-process.ts`:**

This handler will process LinkedIn inbound messages with all AI and enrichment operations.

**Note (Phase 33 dependency):** Do **not** run lead scoring inside this job. Enqueue `LEAD_SCORING_POST_PROCESS` for the inbound `messageId` (dedupe-safe) so scoring runs as a separate background job invocation.

**LinkedIn-Specific Operations:**
1. **AI Sentiment Classification** (same as SMS/email)
2. **Draft Generation** (same as SMS/email)
3. **Clay Enrichment** (LinkedIn-specific: profile URL → company data)
4. **GHL Contact Sync** (if workspace has GHL enabled)
5. **Contact Data Extraction** (email/phone from message signature)
6. **Follow-Up Automation** (pause on reply, auto-start sequences)

**Handler Structure:**

```typescript
import "server-only";

import { prisma } from "@/lib/prisma";
import { buildSentimentTranscriptFromMessages, classifySentiment, SENTIMENT_TO_STATUS, isPositiveSentiment } from "@/lib/sentiment";
import { generateResponseDraft, shouldGenerateDraft } from "@/lib/ai-drafts";
import { extractContactFromMessageContent } from "@/lib/signature-extractor";
import { triggerEnrichmentForLead } from "@/lib/clay-api";
import { ensureGhlContactIdForLead, syncGhlContactPhoneForLead } from "@/lib/ghl-contacts";
import { autoStartMeetingRequestedSequenceIfEligible } from "@/lib/followup-automation";
import { pauseFollowUpsOnReply, resumeAwaitingEnrichmentFollowUpsForLead } from "@/lib/followup-engine";
import { toStoredPhone } from "@/lib/phone-utils";
import { bumpLeadMessageRollup } from "@/lib/lead-message-rollups";

export async function runLinkedInInboundPostProcessJob(params: {
  clientId: string;
  leadId: string;
  messageId: string;
}): Promise<void> {
  console.log(`[LinkedIn Post-Process] Starting for message ${params.messageId}`);

  // Fetch message + lead + client
  const message = await prisma.message.findUnique({
    where: { id: params.messageId },
    include: {
      lead: {
        include: {
          client: {
            include: {
              workspaceSettings: true,
            },
          },
        },
      },
    },
  });

  if (!message) {
    console.error(`[LinkedIn Post-Process] Message not found: ${params.messageId}`);
    return;
  }

  if (!message.lead) {
    console.error(`[LinkedIn Post-Process] Lead not found for message: ${params.messageId}`);
    return;
  }

  const lead = message.lead;
  const client = lead.client;

  // Skip outbound messages
  if (message.direction === "OUTBOUND") {
    console.log(`[LinkedIn Post-Process] Skipping outbound message`);
    return;
  }

  // 1. Extract Contact Info from Message
  // LinkedIn messages may contain email/phone in signature
  const extractedContact = extractContactFromMessageContent(message.content);

  if (extractedContact.email && !lead.email) {
    console.log(`[LinkedIn Post-Process] Extracted email: ${extractedContact.email}`);
    await prisma.lead.update({
      where: { id: lead.id },
      data: { email: extractedContact.email },
    });
  }

  if (extractedContact.phone && !lead.phone) {
    const storedPhone = toStoredPhone(extractedContact.phone);
    console.log(`[LinkedIn Post-Process] Extracted phone: ${storedPhone}`);
    await prisma.lead.update({
      where: { id: lead.id },
      data: { phone: storedPhone },
    });

    // Sync phone to GHL if enabled
    if (client.ghlApiKey && client.ghlLocationId) {
      await syncGhlContactPhoneForLead(lead.id, storedPhone);
    }
  }

  // 2. AI Sentiment Classification
  const recentMessages = await prisma.message.findMany({
    where: { leadId: lead.id, channel: "linkedin" },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const transcript = buildSentimentTranscriptFromMessages(recentMessages.reverse());

  if (!message.sentiment) {
    const sentimentResult = await classifySentiment({
      clientId: client.id,
      transcript,
      channel: "linkedin",
    });

    if (sentimentResult.tag) {
      await prisma.message.update({
        where: { id: message.id },
        data: { sentiment: sentimentResult.tag },
      });

      const newStatus = SENTIMENT_TO_STATUS[sentimentResult.tag];
      if (newStatus) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: { status: newStatus },
        });
      }
    }
  } else {
    console.log(`[LinkedIn Post-Process] Sentiment already analyzed`);
  }

  // 3. Pause Follow-Ups on Reply
  await pauseFollowUpsOnReply(lead.id);

  // 4. Clay Enrichment (if enabled and lead has LinkedIn URL)
  if (client.clayApiKey && lead.linkedinUrl) {
    console.log(`[LinkedIn Post-Process] Triggering Clay enrichment for ${lead.linkedinUrl}`);

    try {
      await triggerEnrichmentForLead({
        leadId: lead.id,
        clientId: client.id,
        linkedinUrl: lead.linkedinUrl,
      });

      // Resume follow-ups that were waiting for enrichment
      await resumeAwaitingEnrichmentFollowUpsForLead(lead.id);
    } catch (error) {
      console.error(`[LinkedIn Post-Process] Enrichment failed:`, error);
      // Non-fatal: continue processing
    }
  }

  // 5. GHL Contact Sync (ensure contact exists in GHL)
  if (client.ghlApiKey && client.ghlLocationId) {
    try {
      await ensureGhlContactIdForLead(lead.id);
    } catch (error) {
      console.error(`[LinkedIn Post-Process] GHL sync failed:`, error);
      // Non-fatal
    }
  }

  // 6. Auto-Start Follow-Up Sequences
  const isPositive = message.sentiment ? isPositiveSentiment(message.sentiment) : false;
  if (isPositive) {
    await autoStartMeetingRequestedSequenceIfEligible(lead.id, client.id);
  }

  // 7. AI Draft Generation
  const shouldDraft = await shouldGenerateDraft({
    leadId: lead.id,
    messageId: message.id,
    channel: "linkedin",
    isInbound: true,
  });

  if (shouldDraft) {
    console.log(`[LinkedIn Post-Process] Generating draft`);

    const draftResult = await generateResponseDraft({
      leadId: lead.id,
      messageId: message.id,
      channel: "linkedin",
      triggerMessageId: message.id,
    });

    if (!draftResult.success) {
      console.error(`[LinkedIn Post-Process] Draft generation failed: ${draftResult.error}`);
    }

    // Note: LinkedIn drafts typically require manual review (no auto-send)
    // because LinkedIn has stricter anti-spam policies
  }

  // 8. Update Lead Rollups
  await bumpLeadMessageRollup(lead.id);

  console.log(`[LinkedIn Post-Process] Completed for message ${params.messageId}`);
}
```

**Key Differences from SMS:**
- **Contact extraction** from message body (LinkedIn users often include contact info)
- **Clay enrichment** via LinkedIn URL (async operation, can take 10-30s)
- **GHL contact sync** to mirror LinkedIn leads in GHL CRM
- **No auto-send** for drafts (LinkedIn requires manual review to avoid spam flags)
- **No snooze detection** (less common in LinkedIn DMs)
- **No timezone inference** (LinkedIn doesn't have timezone signals like SMS)

### 2. Refactor LinkedIn Webhook

**Edit `app/api/webhooks/linkedin/route.ts`:**

**Current behavior:**
- `handleInboundMessage()` does everything inline (sentiment, drafts, enrichment, GHL sync)

**New behavior:**
- `handleInboundMessage()` creates Message + enqueues job

**Changes:**

1. **Remove AI/enrichment imports**:
   ```typescript
   // REMOVE:
   import { classifySentiment, buildSentimentTranscriptFromMessages, isPositiveSentiment } from "@/lib/sentiment";
   import { generateResponseDraft, shouldGenerateDraft } from "@/lib/ai-drafts";
   import { extractContactFromMessageContent } from "@/lib/signature-extractor";
   import { triggerEnrichmentForLead } from "@/lib/clay-api";
   import { ensureGhlContactIdForLead, syncGhlContactPhoneForLead } from "@/lib/ghl-contacts";
   import { autoStartMeetingRequestedSequenceIfEligible } from "@/lib/followup-automation";
   import { pauseFollowUpsOnReply, resumeAwaitingEnrichmentFollowUpsForLead } from "@/lib/followup-engine";
   ```

2. **Add background job imports**:
   ```typescript
   import { enqueueBackgroundJob, buildJobDedupeKey } from "@/lib/background-jobs/enqueue";
   import { BackgroundJobType } from "@prisma/client";
   ```

3. **Simplify `handleInboundMessage()` function**:
   ```typescript
   async function handleInboundMessage(clientId: string, payload: UnipileWebhookPayload) {
     const message = payload.message;
     if (!message) {
       console.error("[LinkedIn Webhook] No message data");
       return;
     }

     const senderLinkedInUrl = normalizeLinkedInUrl(message.sender_linkedin_url);

     // Find or create lead (existing logic, keep as-is)
     let lead = await prisma.lead.findFirst({ /* ... */ });

     if (!lead && senderLinkedInUrl) {
       // Create lead (existing logic, keep as-is)
       lead = await prisma.lead.create({ /* ... */ });
     }

     if (!lead) {
       console.error("[LinkedIn Webhook] Could not find or create lead");
       return;
     }

     // Create or find message
     let msg = await prisma.message.findFirst({
       where: { unipileMessageId: message.id },
     });

     if (!msg) {
       msg = await prisma.message.create({
         data: {
           unipileMessageId: message.id,
           leadId: lead.id,
           clientId,
           channel: "linkedin",
           direction: "INBOUND",
           content: message.text || "",
           externalCreatedAt: new Date(message.timestamp),
         },
       });
     }

     // Enqueue background job
     const dedupeKey = buildJobDedupeKey(
       clientId,
       msg.id,
       BackgroundJobType.LINKEDIN_INBOUND_POST_PROCESS
     );

     await enqueueBackgroundJob({
       type: BackgroundJobType.LINKEDIN_INBOUND_POST_PROCESS,
       clientId,
       leadId: lead.id,
       messageId: msg.id,
       dedupeKey,
     });

     console.log(`[LinkedIn Webhook] Enqueued post-process job for message ${msg.id}`);
   }
   ```

4. **Remove all inline AI/enrichment code** from `handleInboundMessage()`

5. **Keep `handleConnectionAccepted()` as-is** (connection events don't need post-processing)

### 3. Update Runner

Ensure `lib/background-jobs/runner.ts` has LinkedIn case:

```typescript
case BackgroundJobType.LINKEDIN_INBOUND_POST_PROCESS: {
  await runLinkedInInboundPostProcessJob({
    clientId: lockedJob.clientId,
    leadId: lockedJob.leadId,
    messageId: lockedJob.messageId,
  });
  break;
}
```

### 4. Testing

**Manual End-to-End Test:**

1. **Send test LinkedIn DM** (use Unipile account or real LinkedIn)

2. **Check webhook response**:
   - Vercel logs: webhook completes < 2s
   - Response: `{ success: true }`

3. **Verify BackgroundJob created**:
   - Prisma Studio → BackgroundJob table
   - Find job with `type = LINKEDIN_INBOUND_POST_PROCESS`
   - Status = `PENDING`

4. **Trigger cron** (manual or wait):
   ```bash
   curl -X POST https://<domain>/api/cron/background-jobs \
     -H "Authorization: Bearer $CRON_SECRET"
   ```

5. **Verify job processed**:
   - BackgroundJob status → `SUCCEEDED`
   - Message has `sentiment` field
   - Lead status updated
   - AIDraft created
   - Clay enrichment triggered (if enabled)
   - GHL contact synced (if enabled)

**LinkedIn-Specific Tests:**

1. **Contact extraction**:
   - Send DM with email in signature: "Best, John\njohn@example.com"
   - Job processes → Lead.email updated

2. **Clay enrichment**:
   - Lead with `linkedinUrl` + client with `clayApiKey`
   - Job processes → `triggerEnrichmentForLead()` called
   - Check Clay webhook received enrichment request

3. **GHL sync**:
   - Lead from LinkedIn → job processes → `ensureGhlContactIdForLead()` called
   - Lead has `ghlContactId` populated

4. **Connection events** (non-message):
   - Trigger `connection.accepted` webhook
   - Webhook processes normally (no job enqueued)
   - No errors

### 5. Rollback Plan

Same as Phase 35b: revert webhook changes, keep schema/handler.

## Output

### Files Created/Modified

1. ✅ `lib/background-jobs/linkedin-inbound-post-process.ts` — New job handler
2. ✅ `app/api/webhooks/linkedin/route.ts` — Refactored to minimal-write + enqueue
3. ✅ `lib/background-jobs/runner.ts` — LinkedIn case added

### Verification Checklist

- [ ] `npm run lint` passes
- [ ] `npm run build` succeeds
- [ ] Test LinkedIn DM → webhook responds < 2s
- [ ] BackgroundJob created (status=PENDING)
- [ ] Cron processes job (status=SUCCEEDED)
- [ ] Sentiment populated
- [ ] Draft generated
- [ ] Clay enrichment triggered (if applicable)
- [ ] GHL contact synced (if applicable)
- [ ] Contact info extracted from signature (if present)
- [ ] Connection events handled without errors

### Success Criteria

- LinkedIn webhook response time < 2s
- All AI/enrichment operations in background job
- Clay enrichment works asynchronously (no webhook timeout)
- GHL sync works asynchronously
- No functional regressions

## Handoff

**To Phase 35d (SmartLead Webhook Refactor):**

LinkedIn webhook successfully refactored. Two webhooks done (SMS, LinkedIn).

**SmartLead refactor next:**
- Create `lib/background-jobs/smartlead-inbound-post-process.ts`
- SmartLead is similar to email (same channel, similar processing)
- Move sentiment + drafts to background job
- Update webhook to enqueue `SMARTLEAD_INBOUND_POST_PROCESS`

**SmartLead-specific considerations:**
- Email channel (like Inboxxia)
- May have campaign-specific logic
- Check for unique message ID field (`smartleadReplyId` or similar)
