# Phase 35b — GHL SMS Webhook Refactor

## Focus

Refactor the GoHighLevel SMS webhook to follow the background job pattern: minimal synchronous processing (create Message + enqueue job) with all AI operations (sentiment, drafts, auto-reply) moved to a dedicated `SMS_INBOUND_POST_PROCESS` background job handler. Also enqueue a separate `LEAD_SCORING_POST_PROCESS` job for each inbound message (do not score inline).

## Inputs

- Phase 35a output: Schema with `SMS_INBOUND_POST_PROCESS` enum value, `enqueueBackgroundJob()` utility
- Current implementation: `app/api/webhooks/ghl/sms/route.ts`
- Reference pattern: `app/api/webhooks/email/route.ts` + `lib/background-jobs/email-inbound-post-process.ts`

## Work

### 1. Create SMS Background Job Handler

**Create `lib/background-jobs/sms-inbound-post-process.ts`:**

This file will contain ALL the AI/enrichment logic currently in the SMS webhook.

**Note (Phase 33 dependency):** Do **not** run lead scoring inside this job. Enqueue `LEAD_SCORING_POST_PROCESS` for `params.messageId` (dedupe-safe) so scoring runs as a separate background job invocation.

**Structure (similar to email-inbound-post-process.ts):**

```typescript
import "server-only";

import { prisma } from "@/lib/prisma";
import { buildSentimentTranscriptFromMessages, classifySentiment, SENTIMENT_TO_STATUS } from "@/lib/sentiment";
import { generateResponseDraft, shouldGenerateDraft } from "@/lib/ai-drafts";
import { decideShouldAutoReply } from "@/lib/auto-reply-gate";
import { evaluateAutoSend } from "@/lib/auto-send-evaluator";
import { approveAndSendDraftSystem } from "@/actions/message-actions";
import { pauseFollowUpsOnReply, pauseFollowUpsUntil, processMessageForAutoBooking } from "@/lib/followup-engine";
import { ensureLeadTimezone } from "@/lib/timezone-inference";
import { detectSnoozedUntilUtcFromMessage } from "@/lib/snooze-detection";
import { bumpLeadMessageRollup } from "@/lib/lead-message-rollups";
import { autoStartMeetingRequestedSequenceIfEligible } from "@/lib/followup-automation";
import { sendSlackDmByEmail } from "@/lib/slack-dm";
import { getPublicAppUrl } from "@/lib/app-url";

export async function runSmsInboundPostProcessJob(params: {
  clientId: string;
  leadId: string;
  messageId: string;
}): Promise<void> {
  console.log(`[SMS Post-Process] Starting for message ${params.messageId}`);

  // Fetch message + lead + client with all necessary relations
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
    console.error(`[SMS Post-Process] Message not found: ${params.messageId}`);
    return;
  }

  if (!message.lead) {
    console.error(`[SMS Post-Process] Lead not found for message: ${params.messageId}`);
    return;
  }

  const lead = message.lead;
  const client = lead.client;
  const settings = client.workspaceSettings;

  // Skip processing for outbound messages
  if (message.direction === "OUTBOUND") {
    console.log(`[SMS Post-Process] Skipping outbound message ${params.messageId}`);
    return;
  }

  // 1. Timezone Inference
  // (SMS messages may contain timezone hints like "I'm in PST")
  await ensureLeadTimezone({ leadId: lead.id, clientId: client.id });

  // 2. Snooze Detection
  // (e.g., "text me next week")
  const snoozedUntil = detectSnoozedUntilUtcFromMessage({
    content: message.content,
    leadTimezone: lead.timezone || undefined,
  });

  if (snoozedUntil) {
    console.log(`[SMS Post-Process] Detected snooze until ${snoozedUntil.toISOString()}`);
    await pauseFollowUpsUntil(lead.id, snoozedUntil, "Snooze detected in SMS reply");
  }

  // 3. AI Sentiment Classification
  // Build transcript from recent messages
  const recentMessages = await prisma.message.findMany({
    where: { leadId: lead.id, channel: "sms" },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const transcript = buildSentimentTranscriptFromMessages(recentMessages.reverse());

  // Check if sentiment already analyzed (idempotency)
  if (!message.sentiment) {
    const sentimentResult = await classifySentiment({
      clientId: client.id,
      transcript,
      channel: "sms",
    });

    if (sentimentResult.tag) {
      // Update message with sentiment
      await prisma.message.update({
        where: { id: message.id },
        data: { sentiment: sentimentResult.tag },
      });

      // Update lead status based on sentiment
      const newStatus = SENTIMENT_TO_STATUS[sentimentResult.tag];
      if (newStatus) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: { status: newStatus },
        });
      }
    }
  } else {
    console.log(`[SMS Post-Process] Sentiment already analyzed: ${message.sentiment}`);
  }

  // 4. Pause Follow-Ups on Reply
  // (Inbound reply = lead is engaged, pause automated sequences)
  await pauseFollowUpsOnReply(lead.id);

  // 5. Auto-Booking Check
  // (If message indicates meeting acceptance, process booking)
  await processMessageForAutoBooking(message.id);

  // 6. Auto-Start Follow-Up Sequences
  // (If sentiment = Meeting Requested, start appropriate sequence)
  await autoStartMeetingRequestedSequenceIfEligible(lead.id, client.id);

  // 7. AI Draft Generation
  // Check if we should generate a draft
  const shouldDraft = await shouldGenerateDraft({
    leadId: lead.id,
    messageId: message.id,
    channel: "sms",
    isInbound: true,
  });

  if (shouldDraft) {
    console.log(`[SMS Post-Process] Generating draft for message ${message.id}`);

    const draftResult = await generateResponseDraft({
      leadId: lead.id,
      messageId: message.id,
      channel: "sms",
      triggerMessageId: message.id,
    });

    if (draftResult.success && draftResult.data) {
      const draft = draftResult.data;

      // 8. Auto-Reply Gate Check
      const shouldAutoReply = decideShouldAutoReply({
        leadStatus: lead.status,
        sentiment: message.sentiment || undefined,
        hasAppointment: !!lead.appointmentStartAt,
        lastMessageDirection: message.direction,
      });

      if (shouldAutoReply) {
        // 9. Auto-Send Evaluation
        const autoSendResult = await evaluateAutoSend({
          draftId: draft.id,
          leadId: lead.id,
          clientId: client.id,
        });

        if (autoSendResult.shouldSend) {
          console.log(`[SMS Post-Process] Auto-sending draft ${draft.id}`);

          const sendResult = await approveAndSendDraftSystem(draft.id);

          if (!sendResult.success) {
            console.error(`[SMS Post-Process] Auto-send failed: ${sendResult.error}`);
          }
        } else {
          console.log(`[SMS Post-Process] Auto-send blocked: ${autoSendResult.reason}`);
        }
      }
    }
  }

  // 10. Update Lead Rollups
  // (Last message timestamp, unread count, etc.)
  await bumpLeadMessageRollup(lead.id);

  // 11. Slack Notification (Optional)
  // If workspace has Slack enabled + lead is high-priority, notify
  if (settings?.slackEnabled && lead.status === "Hot Lead") {
    const appUrl = getPublicAppUrl();
    const leadUrl = `${appUrl}/?clientId=${client.id}&leadId=${lead.id}`;

    await sendSlackDmByEmail({
      recipientEmail: client.email,
      text: `🔥 Hot lead replied via SMS: ${lead.firstName || "Unknown"} - ${leadUrl}`,
    });
  }

  console.log(`[SMS Post-Process] Completed for message ${params.messageId}`);
}
```

**Key Points:**
- Replicates ALL existing SMS webhook logic (no behavior change)
- Idempotent (checks if sentiment already exists before re-running)
- Fetches all data from DB (no dependency on webhook payload)
- Wrapped in try/catch by runner (no need to handle at job level)

### 2. Refactor SMS Webhook

**Edit `app/api/webhooks/ghl/sms/route.ts`:**

**Current behavior:** Webhook does everything inline (sentiment, drafts, auto-reply).

**New behavior:** Webhook only creates Message + enqueues job.

**Changes:**

1. **Remove AI imports** (no longer needed in webhook):
   ```typescript
   // REMOVE:
   import { classifySentiment, buildSentimentTranscriptFromMessages, SENTIMENT_TO_STATUS } from "@/lib/sentiment";
   import { generateResponseDraft, shouldGenerateDraft } from "@/lib/ai-drafts";
   import { decideShouldAutoReply } from "@/lib/auto-reply-gate";
   import { evaluateAutoSend } from "@/lib/auto-send-evaluator";
   import { approveAndSendDraftSystem } from "@/actions/message-actions";
   import { pauseFollowUpsOnReply, processMessageForAutoBooking } from "@/lib/followup-engine";
   import { ensureLeadTimezone } from "@/lib/timezone-inference";
   import { detectSnoozedUntilUtcFromMessage } from "@/lib/snooze-detection";
   ```

2. **Add background job imports**:
   ```typescript
   import { enqueueBackgroundJob, buildJobDedupeKey } from "@/lib/background-jobs/enqueue";
   import { BackgroundJobType } from "@prisma/client";
   ```

3. **Simplify POST handler** (after message creation):
   ```typescript
   // After creating/finding message...

   // Enqueue background job for async processing
   const dedupeKey = buildJobDedupeKey(client.id, message.id, BackgroundJobType.SMS_INBOUND_POST_PROCESS);

   await enqueueBackgroundJob({
     type: BackgroundJobType.SMS_INBOUND_POST_PROCESS,
     clientId: client.id,
     leadId: lead.id,
     messageId: message.id,
     dedupeKey,
   });

   console.log(`[GHL SMS Webhook] Enqueued post-process job for message ${message.id}`);

   return NextResponse.json({ success: true });
   ```

4. **Remove all inline AI processing** (sentiment, drafts, auto-reply, etc.):
   - Delete sentiment classification code
   - Delete draft generation code
   - Delete auto-reply logic
   - Delete snooze detection
   - Delete timezone inference
   - Keep only: message creation + job enqueue

**Result:** Webhook handler should be ~100-150 lines (down from ~400+), responding in < 2s.

### 3. Update Runner (if not done in 35a)

Ensure `lib/background-jobs/runner.ts` has SMS_INBOUND_POST_PROCESS case:

```typescript
case BackgroundJobType.SMS_INBOUND_POST_PROCESS: {
  await runSmsInboundPostProcessJob({
    clientId: lockedJob.clientId,
    leadId: lockedJob.leadId,
    messageId: lockedJob.messageId,
  });
  break;
}
```

### 4. Testing

**Manual End-to-End Test:**

1. **Send test SMS to GHL number** (use GHL workflows or direct SMS)

2. **Check webhook response**:
   - Vercel logs: webhook should complete in < 2s
   - Response: `{ success: true }`

3. **Verify BackgroundJob created**:
   ```bash
   npm run db:studio
   ```
   - Open BackgroundJob table
   - Find job with `type = SMS_INBOUND_POST_PROCESS` and `messageId = <message_id>`
   - Status should be `PENDING`

4. **Trigger cron manually** (or wait for scheduled run):
   ```bash
   curl -X POST https://<your-vercel-domain>/api/cron/background-jobs \
     -H "Authorization: Bearer $CRON_SECRET"
   ```

5. **Verify job processed**:
   - BackgroundJob status → `SUCCEEDED`
   - Message has `sentiment` field populated
   - Lead status updated (if sentiment changed)
   - AIDraft created (if applicable)
   - Vercel logs show job processing

6. **Test webhook retry** (duplicate detection):
   - Re-send same SMS (same `ghlId`)
   - Webhook should skip message creation (unique constraint)
   - No duplicate job enqueued (dedupeKey constraint)

**Error Scenario Tests:**

1. **OpenAI API failure**:
   - Temporarily break OpenAI API key
   - Send SMS → job enqueued
   - Job runs → fails (OpenAI error)
   - BackgroundJob status → `PENDING` (retrying)
   - Check `lastError` field has error message
   - Restore API key → next cron run succeeds

2. **Job max retries**:
   - Set `maxAttempts = 1` for test job
   - Cause failure (bad data)
   - Job runs → fails → attempts = 1
   - Status → `FAILED` (no more retries)

**Performance Test:**

- Send 10 SMS messages in rapid succession
- Verify all webhooks complete < 2s
- Verify all 10 jobs enqueued
- Verify all 10 jobs processed by cron

### 5. Rollback Plan

If refactor causes issues:

1. **Revert webhook changes** → restore inline AI processing
2. **Keep schema changes** (BackgroundJobType enum) → no harm
3. **Keep job handler** → not executed if webhook doesn't enqueue

## Output

### Files Created/Modified

1. ✅ `lib/background-jobs/sms-inbound-post-process.ts` — New job handler (all SMS AI logic)
2. ✅ `app/api/webhooks/ghl/sms/route.ts` — Refactored to minimal-write + enqueue
3. ✅ `lib/background-jobs/runner.ts` — SMS case added to switch statement (if not in 35a)

### Verification Checklist

- [ ] `npm run lint` passes
- [ ] `npm run build` succeeds
- [ ] Test SMS sent → webhook responds < 2s
- [ ] BackgroundJob created with status=PENDING
- [ ] Cron processes job → status=SUCCEEDED
- [ ] Message has sentiment populated
- [ ] Lead status updated correctly
- [ ] Draft generated (if applicable)
- [ ] Webhook retry doesn't create duplicate message/job
- [ ] OpenAI failure → job retries with backoff
- [ ] AIInteraction rows created (telemetry preserved)

### Success Criteria

- SMS webhook response time < 2s (measured in Vercel logs)
- All AI operations moved to background job
- No functional regressions (sentiment, drafts, auto-reply all work)
- Job retries on failure with exponential backoff
- Duplicate webhook calls handled gracefully

## Handoff

**To Phase 35c (LinkedIn Webhook Refactor):**

GHL SMS webhook successfully refactored. Pattern established:

1. Webhook: minimal write + `enqueueBackgroundJob()`
2. Job handler: all AI logic (idempotent)
3. Runner: dispatch to handler

**LinkedIn refactor should follow same pattern:**
- Create `lib/background-jobs/linkedin-inbound-post-process.ts`
- Move all AI/enrichment logic from LinkedIn webhook
- Update LinkedIn webhook to enqueue `LINKEDIN_INBOUND_POST_PROCESS` job
- Test end-to-end

**LinkedIn-specific considerations:**
- Enrichment (Clay API) takes 10-30s → perfect for background job
- GHL contact sync should also move to job handler
- Connection events (not messages) don't need post-processing
