# Phase 35d — SmartLead Webhook Refactor

## Focus

Refactor the SmartLead webhook to follow the background job pattern, moving AI sentiment and draft generation to an async `SMARTLEAD_INBOUND_POST_PROCESS` job handler. Also enqueue a separate `LEAD_SCORING_POST_PROCESS` job for each inbound message (do not score inline).

## Inputs

- Phase 35c output: LinkedIn webhook successfully refactored
- Current implementation: `app/api/webhooks/smartlead/route.ts`
- Reference pattern: `lib/background-jobs/email-inbound-post-process.ts` (SmartLead is email channel)

## Work

### 1. Create SmartLead Background Job Handler

**Create `lib/background-jobs/smartlead-inbound-post-process.ts`:**

SmartLead is an email outreach platform (like Inboxxia/EmailBison), so the job handler should be similar to `email-inbound-post-process.ts` with SmartLead-specific quirks.

**Note (Phase 33 dependency):** Do **not** run lead scoring inside this job. Enqueue `LEAD_SCORING_POST_PROCESS` for the inbound `messageId` (dedupe-safe) so scoring runs as a separate background job invocation.

**Handler Structure:**

```typescript
import "server-only";

import { prisma } from "@/lib/prisma";
import { buildSentimentTranscriptFromMessages, classifySentiment, SENTIMENT_TO_STATUS } from "@/lib/sentiment";
import { generateResponseDraft, shouldGenerateDraft } from "@/lib/ai-drafts";
import { decideShouldAutoReply } from "@/lib/auto-reply-gate";
import { evaluateAutoSend } from "@/lib/auto-send-evaluator";
import { approveAndSendDraftSystem } from "@/actions/message-actions";
import { pauseFollowUpsOnReply } from "@/lib/followup-engine";
import { bumpLeadMessageRollup } from "@/lib/lead-message-rollups";
import { cleanEmailBody } from "@/lib/email-cleaning";

export async function runSmartLeadInboundPostProcessJob(params: {
  clientId: string;
  leadId: string;
  messageId: string;
}): Promise<void> {
  console.log(`[SmartLead Post-Process] Starting for message ${params.messageId}`);

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
    console.error(`[SmartLead Post-Process] Message not found`);
    return;
  }

  if (!message.lead) {
    console.error(`[SmartLead Post-Process] Lead not found`);
    return;
  }

  const lead = message.lead;
  const client = lead.client;

  // Skip outbound messages
  if (message.direction === "OUTBOUND") {
    console.log(`[SmartLead Post-Process] Skipping outbound`);
    return;
  }

  // 1. Clean Email Body (remove quoted replies, signatures)
  const cleanedContent = cleanEmailBody(message.content);

  // 2. AI Sentiment Classification
  const recentMessages = await prisma.message.findMany({
    where: { leadId: lead.id, channel: "email" },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const transcript = buildSentimentTranscriptFromMessages(recentMessages.reverse());

  if (!message.sentiment) {
    const sentimentResult = await classifySentiment({
      clientId: client.id,
      transcript,
      channel: "email",
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
    console.log(`[SmartLead Post-Process] Sentiment already analyzed`);
  }

  // 3. Pause Follow-Ups on Reply
  await pauseFollowUpsOnReply(lead.id);

  // 4. AI Draft Generation
  const shouldDraft = await shouldGenerateDraft({
    leadId: lead.id,
    messageId: message.id,
    channel: "email",
    isInbound: true,
  });

  if (shouldDraft) {
    console.log(`[SmartLead Post-Process] Generating draft`);

    const draftResult = await generateResponseDraft({
      leadId: lead.id,
      messageId: message.id,
      channel: "email",
      triggerMessageId: message.id,
    });

    if (draftResult.success && draftResult.data) {
      const draft = draftResult.data;

      // 5. Auto-Reply Gate Check
      const shouldAutoReply = decideShouldAutoReply({
        leadStatus: lead.status,
        sentiment: message.sentiment || undefined,
        hasAppointment: !!lead.appointmentStartAt,
        lastMessageDirection: message.direction,
      });

      if (shouldAutoReply) {
        // 6. Auto-Send Evaluation
        const autoSendResult = await evaluateAutoSend({
          draftId: draft.id,
          leadId: lead.id,
          clientId: client.id,
        });

        if (autoSendResult.shouldSend) {
          console.log(`[SmartLead Post-Process] Auto-sending draft ${draft.id}`);

          const sendResult = await approveAndSendDraftSystem(draft.id);

          if (!sendResult.success) {
            console.error(`[SmartLead Post-Process] Auto-send failed: ${sendResult.error}`);
          }
        } else {
          console.log(`[SmartLead Post-Process] Auto-send blocked: ${autoSendResult.reason}`);
        }
      }
    }
  }

  // 7. Update Lead Rollups
  await bumpLeadMessageRollup(lead.id);

  console.log(`[SmartLead Post-Process] Completed for message ${params.messageId}`);
}
```

**Key Points:**
- Email channel (like Inboxxia)
- Email body cleaning (remove quoted text)
- Auto-reply supported (email has better deliverability than LinkedIn)
- Similar to `email-inbound-post-process.ts` but without signature extraction (SmartLead typically has structured lead data)

### 2. Refactor SmartLead Webhook

**Edit `app/api/webhooks/smartlead/route.ts`:**

**Current behavior:** Webhook does inline sentiment + drafts.

**New behavior:** Webhook creates Message + enqueues job.

**Changes:**

1. **Remove AI imports**:
   ```typescript
   // REMOVE:
   import { classifySentiment, buildSentimentTranscriptFromMessages, SENTIMENT_TO_STATUS } from "@/lib/sentiment";
   import { generateResponseDraft, shouldGenerateDraft } from "@/lib/ai-drafts";
   import { decideShouldAutoReply } from "@/lib/auto-reply-gate";
   import { evaluateAutoSend } from "@/lib/auto-send-evaluator";
   import { approveAndSendDraftSystem } from "@/actions/message-actions";
   ```

2. **Add background job imports**:
   ```typescript
   import { enqueueBackgroundJob, buildJobDedupeKey } from "@/lib/background-jobs/enqueue";
   import { BackgroundJobType } from "@prisma/client";
   ```

3. **Simplify webhook handler** (after message creation):
   ```typescript
   // After creating message...

   // Enqueue background job
   const dedupeKey = buildJobDedupeKey(
     client.id,
     message.id,
     BackgroundJobType.SMARTLEAD_INBOUND_POST_PROCESS
   );

   await enqueueBackgroundJob({
     type: BackgroundJobType.SMARTLEAD_INBOUND_POST_PROCESS,
     clientId: client.id,
     leadId: lead.id,
     messageId: message.id,
     dedupeKey,
   });

   console.log(`[SmartLead Webhook] Enqueued post-process job for message ${message.id}`);

   return NextResponse.json({ success: true });
   ```

4. **Remove all inline AI processing**

5. **Verify unique constraint** on SmartLead message ID field:
   - Check `prisma/schema.prisma` for field name (e.g., `smartleadReplyId`)
   - Ensure `@@index([smartleadReplyId])` exists
   - If missing, add it in Phase 35a or here

### 3. Update Runner

Ensure `lib/background-jobs/runner.ts` has SmartLead case:

```typescript
case BackgroundJobType.SMARTLEAD_INBOUND_POST_PROCESS: {
  await runSmartLeadInboundPostProcessJob({
    clientId: lockedJob.clientId,
    leadId: lockedJob.leadId,
    messageId: lockedJob.messageId,
  });
  break;
}
```

### 4. Testing

**Manual End-to-End Test:**

1. **Trigger SmartLead webhook** (send test email reply via SmartLead)

2. **Check webhook response**:
   - Vercel logs: webhook completes < 2s
   - Response: `{ success: true }`

3. **Verify BackgroundJob created**:
   - Prisma Studio → BackgroundJob table
   - Type = `SMARTLEAD_INBOUND_POST_PROCESS`
   - Status = `PENDING`

4. **Trigger cron**:
   ```bash
   curl -X POST https://<domain>/api/cron/background-jobs \
     -H "Authorization: Bearer $CRON_SECRET"
   ```

5. **Verify job processed**:
   - Status → `SUCCEEDED`
   - Message has `sentiment`
   - Lead status updated
   - Draft created (if applicable)
   - Auto-send triggered (if applicable)

**SmartLead-Specific Tests:**

1. **Email body cleaning**:
   - Send reply with quoted text (">>" prefix)
   - Job processes → sentiment based on cleaned content (not quoted text)

2. **Auto-reply**:
   - Positive sentiment reply (e.g., "Yes, I'm interested")
   - Job processes → draft created → auto-send evaluates → email sent

3. **Webhook retry**:
   - Re-send same webhook (same SmartLead reply ID)
   - Webhook skips (unique constraint)
   - No duplicate job

### 5. Schema Verification

**Check Message model for SmartLead ID field:**

```bash
grep -A5 "smartlead" prisma/schema.prisma
```

Expected field (example names):
- `smartleadReplyId` or
- `smartleadMessageId` or
- `smartleadId`

If missing or not indexed, add:

```prisma
model Message {
  // ...
  smartleadReplyId  String?   @unique  // Or appropriate field name
  // ...

  @@index([smartleadReplyId])
}
```

Then run `npm run db:push`.

## Output

### Files Created/Modified

1. ✅ `lib/background-jobs/smartlead-inbound-post-process.ts` — New job handler
2. ✅ `app/api/webhooks/smartlead/route.ts` — Refactored to minimal-write + enqueue
3. ✅ `lib/background-jobs/runner.ts` — SmartLead case added
4. ✅ `prisma/schema.prisma` — SmartLead ID field verified/added (if needed)

### Verification Checklist

- [ ] `npm run lint` passes
- [ ] `npm run build` succeeds
- [ ] Test SmartLead webhook → responds < 2s
- [ ] BackgroundJob created (status=PENDING)
- [ ] Cron processes job (status=SUCCEEDED)
- [ ] Sentiment populated
- [ ] Draft generated
- [ ] Auto-reply works (if applicable)
- [ ] Email body cleaning works
- [ ] Webhook retry doesn't create duplicate

### Success Criteria

- SmartLead webhook response time < 2s
- All AI operations in background job
- Auto-reply works asynchronously
- No functional regressions

## Handoff

**To Phase 35e (Instantly Webhook Refactor):**

SmartLead webhook successfully refactored. Three webhooks done (SMS, LinkedIn, SmartLead).

**Instantly refactor next:**
- Create `lib/background-jobs/instantly-inbound-post-process.ts`
- Instantly is also email channel (similar to SmartLead)
- Move sentiment + drafts to background job
- Update webhook to enqueue `INSTANTLY_INBOUND_POST_PROCESS`

**Instantly-specific considerations:**
- Email channel (same as SmartLead)
- Check for unique message ID field (`instantlyReplyId` or similar)
- Likely very similar to SmartLead handler (can reuse most logic)
