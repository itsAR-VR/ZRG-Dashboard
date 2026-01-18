# Phase 35e — Instantly Webhook Refactor

## Focus

Refactor the Instantly webhook to follow the background job pattern, moving AI sentiment and draft generation to an async `INSTANTLY_INBOUND_POST_PROCESS` job handler. Also enqueue a separate `LEAD_SCORING_POST_PROCESS` job for each inbound message (do not score inline). This is the final webhook refactor in Phase 35.

## Inputs

- Phase 35d output: SmartLead webhook successfully refactored
- Current implementation: `app/api/webhooks/instantly/route.ts`
- Reference pattern: `lib/background-jobs/smartlead-inbound-post-process.ts` (both are email platforms)

## Work

### 1. Create Instantly Background Job Handler

**Create `lib/background-jobs/instantly-inbound-post-process.ts`:**

Instantly is an email outreach platform (like SmartLead), so the handler will be nearly identical to SmartLead.

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

export async function runInstantlyInboundPostProcessJob(params: {
  clientId: string;
  leadId: string;
  messageId: string;
}): Promise<void> {
  console.log(`[Instantly Post-Process] Starting for message ${params.messageId}`);

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
    console.error(`[Instantly Post-Process] Message not found`);
    return;
  }

  if (!message.lead) {
    console.error(`[Instantly Post-Process] Lead not found`);
    return;
  }

  const lead = message.lead;
  const client = lead.client;

  // Skip outbound messages
  if (message.direction === "OUTBOUND") {
    console.log(`[Instantly Post-Process] Skipping outbound`);
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
    console.log(`[Instantly Post-Process] Sentiment already analyzed`);
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
    console.log(`[Instantly Post-Process] Generating draft`);

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
          console.log(`[Instantly Post-Process] Auto-sending draft ${draft.id}`);

          const sendResult = await approveAndSendDraftSystem(draft.id);

          if (!sendResult.success) {
            console.error(`[Instantly Post-Process] Auto-send failed: ${sendResult.error}`);
          }
        } else {
          console.log(`[Instantly Post-Process] Auto-send blocked: ${autoSendResult.reason}`);
        }
      }
    }
  }

  // 7. Update Lead Rollups
  await bumpLeadMessageRollup(lead.id);

  console.log(`[Instantly Post-Process] Completed for message ${params.messageId}`);
}
```

**Note:** This is nearly identical to `smartlead-inbound-post-process.ts`. Consider extracting shared logic into a common `email-reply-post-process-shared.ts` helper if desired, but defer to future refactor to keep Phase 35 scope contained.

### 2. Refactor Instantly Webhook

**Edit `app/api/webhooks/instantly/route.ts`:**

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
     BackgroundJobType.INSTANTLY_INBOUND_POST_PROCESS
   );

   await enqueueBackgroundJob({
     type: BackgroundJobType.INSTANTLY_INBOUND_POST_PROCESS,
     clientId: client.id,
     leadId: lead.id,
     messageId: message.id,
     dedupeKey,
   });

   console.log(`[Instantly Webhook] Enqueued post-process job for message ${message.id}`);

   return NextResponse.json({ success: true });
   ```

4. **Remove all inline AI processing**

5. **Verify unique constraint** on Instantly message ID field:
   - Check `prisma/schema.prisma` for field name (e.g., `instantlyReplyId`)
   - Ensure `@@index([instantlyReplyId])` exists
   - If missing, add it

### 3. Update Runner

Ensure `lib/background-jobs/runner.ts` has Instantly case:

```typescript
case BackgroundJobType.INSTANTLY_INBOUND_POST_PROCESS: {
  await runInstantlyInboundPostProcessJob({
    clientId: lockedJob.clientId,
    leadId: lockedJob.leadId,
    messageId: lockedJob.messageId,
  });
  break;
}
```

### 4. Testing

**Manual End-to-End Test:**

1. **Trigger Instantly webhook** (send test email reply via Instantly)

2. **Check webhook response**:
   - Vercel logs: webhook completes < 2s
   - Response: `{ success: true }`

3. **Verify BackgroundJob created**:
   - Prisma Studio → BackgroundJob table
   - Type = `INSTANTLY_INBOUND_POST_PROCESS`
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

**Instantly-Specific Tests:**

1. **Email body cleaning**:
   - Send reply with quoted text
   - Job processes → sentiment based on cleaned content

2. **Auto-reply**:
   - Positive sentiment reply
   - Job processes → draft created → auto-send evaluates → email sent

3. **Webhook retry**:
   - Re-send same webhook (same Instantly reply ID)
   - Webhook skips (unique constraint)
   - No duplicate job

### 5. Schema Verification

**Check Message model for Instantly ID field:**

```bash
grep -A5 "instantly" prisma/schema.prisma
```

Expected field (example names):
- `instantlyReplyId` or
- `instantlyMessageId` or
- `instantlyId`

If missing or not indexed, add:

```prisma
model Message {
  // ...
  instantlyReplyId  String?   @unique  // Or appropriate field name
  // ...

  @@index([instantlyReplyId])
}
```

Then run `npm run db:push`.

## Output

### Files Created/Modified

1. ✅ `lib/background-jobs/instantly-inbound-post-process.ts` — New job handler
2. ✅ `app/api/webhooks/instantly/route.ts` — Refactored to minimal-write + enqueue
3. ✅ `lib/background-jobs/runner.ts` — Instantly case added
4. ✅ `prisma/schema.prisma` — Instantly ID field verified/added (if needed)

### Verification Checklist

- [ ] `npm run lint` passes
- [ ] `npm run build` succeeds
- [ ] Test Instantly webhook → responds < 2s
- [ ] BackgroundJob created (status=PENDING)
- [ ] Cron processes job (status=SUCCEEDED)
- [ ] Sentiment populated
- [ ] Draft generated
- [ ] Auto-reply works (if applicable)
- [ ] Email body cleaning works
- [ ] Webhook retry doesn't create duplicate

### Success Criteria

- Instantly webhook response time < 2s
- All AI operations in background job
- Auto-reply works asynchronously
- No functional regressions

## Handoff

**To Phase 35f (Testing, Validation, and Deployment):**

All four webhook refactors complete:
1. ✅ GHL SMS (Phase 35b)
2. ✅ LinkedIn (Phase 35c)
3. ✅ SmartLead (Phase 35d)
4. ✅ Instantly (Phase 35e)

**Phase 35f will:**
- Run comprehensive end-to-end tests across all webhooks
- Validate performance improvements (webhook response times)
- Test error scenarios (OpenAI failures, job retries, max attempts)
- Verify observability (AIInteraction telemetry preserved)
- Create deployment checklist
- Document rollback procedures
- Final build verification (`npm run lint`, `npm run build`, `npm run db:push`)

**Context for Phase 35f:**
- All background job handlers created: `sms-inbound-post-process.ts`, `linkedin-inbound-post-process.ts`, `smartlead-inbound-post-process.ts`, `instantly-inbound-post-process.ts`
- All webhooks refactored: `ghl/sms/route.ts`, `linkedin/route.ts`, `smartlead/route.ts`, `instantly/route.ts`
- Runner updated with all new job type cases
- Schema extended with 4 new BackgroundJobType values
- Ready for final validation and production deployment
