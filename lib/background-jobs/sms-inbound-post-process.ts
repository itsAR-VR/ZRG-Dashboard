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
import { enqueueLeadScoringJob } from "@/lib/lead-scoring";
import { syncSmsConversationHistorySystem } from "@/lib/conversation-sync";
import { maybeAssignLead } from "@/lib/lead-assignment";

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
            select: {
              id: true,
              settings: true,
            },
          },
          emailCampaign: {
            select: {
              id: true,
              name: true,
              bisonCampaignId: true,
              responseMode: true,
              autoSendConfidenceThreshold: true,
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
  const settings = client.settings;

  // Skip processing for outbound messages
  if (message.direction === "outbound") {
    console.log(`[SMS Post-Process] Skipping outbound message ${params.messageId}`);
    return;
  }

  const messageBody = message.body || "";
  const messageSentAt = message.sentAt || new Date();

  // 1. Timezone Inference
  // SMS messages may contain timezone hints like "I'm in PST"
  await ensureLeadTimezone(lead.id);

  // 2. Snooze Detection
  // If the lead asks to reconnect after a specific date, snooze/pause follow-ups until then.
  const inboundText = messageBody.trim();
  const snoozeKeywordHit =
    /\b(after|until|from)\b/i.test(inboundText) &&
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(inboundText);

  if (snoozeKeywordHit) {
    const tzResult = await ensureLeadTimezone(lead.id);
    const { snoozedUntilUtc, confidence } = detectSnoozedUntilUtcFromMessage({
      messageText: inboundText,
      timeZone: tzResult.timezone || "UTC",
    });

    if (snoozedUntilUtc && confidence >= 0.95) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { snoozedUntil: snoozedUntilUtc },
      });
      await pauseFollowUpsUntil(lead.id, snoozedUntilUtc);
      console.log(`[SMS Post-Process] Detected snooze until ${snoozedUntilUtc.toISOString()}`);
    }
  }

  // 3. AI Sentiment Classification
  // Build transcript from recent messages (up to 30 messages for context).
  // For ultra-short replies with no outbound context, attempt a best-effort SMS history sync first
  // so sentiment/drafts have enough context (e.g., "yes/ok/sure" needs the preceding outbound ask).
  let recentMessages = await prisma.message.findMany({
    where: { leadId: lead.id, channel: "sms" },
    orderBy: { sentAt: "desc" },
    take: 30,
    select: {
      sentAt: true,
      channel: true,
      direction: true,
      body: true,
    },
  });

  const historySyncEnabled = (process.env.SMS_POST_PROCESS_HISTORY_SYNC_ENABLED || "true") === "true";
  const isShortReply = inboundText.length > 0 && inboundText.length <= 25;
  const isSelfContained = /\b(stop|unsubscribe|do not contact|wrong number)\b/i.test(inboundText);
  const hasOutboundContext = recentMessages.some((m) => m.direction === "outbound");

  if (historySyncEnabled && isShortReply && !isSelfContained && !hasOutboundContext && lead.ghlContactId) {
    try {
      const syncResult = await syncSmsConversationHistorySystem(lead.id);
      console.log("[SMS Post-Process] History sync result", {
        success: syncResult.success,
        imported: syncResult.importedCount ?? 0,
        healed: syncResult.healedCount ?? 0,
        reclassified: syncResult.reclassifiedSentiment ?? false,
      });

      if (syncResult.success && (syncResult.importedCount || syncResult.healedCount)) {
        recentMessages = await prisma.message.findMany({
          where: { leadId: lead.id, channel: "sms" },
          orderBy: { sentAt: "desc" },
          take: 30,
          select: {
            sentAt: true,
            channel: true,
            direction: true,
            body: true,
          },
        });
      }
    } catch (error) {
      console.warn("[SMS Post-Process] History sync failed (non-fatal):", error);
    }
  }

  const transcript = buildSentimentTranscriptFromMessages(recentMessages.reverse());

  // Store original sentiment before classification
  const previousSentiment = lead.sentimentTag;

  // Check if sentiment already analyzed (idempotency)
  // Skip re-analysis if lead already has a meaningful sentiment (not "New" or "Neutral")
  const sentimentSnapshot = await prisma.lead.findUnique({
    where: { id: lead.id },
    select: { sentimentTag: true },
  });
  const currentSentiment = sentimentSnapshot?.sentimentTag || lead.sentimentTag;
  const shouldClassify = !currentSentiment || currentSentiment === "New" || currentSentiment === "Neutral";

  if (shouldClassify) {
    const sentimentTag = await classifySentiment(transcript || messageBody, {
      clientId: client.id,
      leadId: lead.id,
      maxRetries: 1,
    });

    if (sentimentTag) {
      // Update lead status based on sentiment
      const newStatus = SENTIMENT_TO_STATUS[sentimentTag];
      if (newStatus) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            status: newStatus,
            sentimentTag,
          },
        });
      }

      console.log(`[SMS Post-Process] AI Classification: ${sentimentTag}`);
    }
  } else {
    console.log(`[SMS Post-Process] Sentiment already analyzed: ${currentSentiment}`);
  }

  // 3b. Round-robin lead assignment (Phase 43)
  // Assign lead to next setter if sentiment is positive and not already assigned
  const finalSentiment = (await prisma.lead.findUnique({
    where: { id: lead.id },
    select: { sentimentTag: true },
  }))?.sentimentTag ?? null;

  await maybeAssignLead({
    leadId: lead.id,
    clientId: client.id,
    sentimentTag: finalSentiment,
  });

  // 4. Pause Follow-Ups on Reply
  // Any inbound reply pauses active follow-up sequences
  await pauseFollowUpsOnReply(lead.id);

  // 5. Auto-Booking Check
  // If message indicates meeting acceptance, process booking
  const autoBook = await processMessageForAutoBooking(lead.id, messageBody);
  if (autoBook.booked) {
    console.log(`[SMS Post-Process] Auto-booked appointment for lead ${lead.id}: ${autoBook.appointmentId}`);
  }

  // 6. Auto-Start Follow-Up Sequences & Draft Generation
  // Reload lead to get updated sentiment after classification
  const updatedLead = await prisma.lead.findUnique({
    where: { id: lead.id },
    select: { sentimentTag: true },
  });

  const newSentiment = updatedLead?.sentimentTag || lead.sentimentTag;

  await autoStartMeetingRequestedSequenceIfEligible({
    leadId: lead.id,
    previousSentiment,
    newSentiment,
  });

  // 7. AI Draft Generation
  // Skip if auto-booked or sentiment doesn't need draft
  const shouldDraft = !autoBook.booked && newSentiment && shouldGenerateDraft(newSentiment);

  if (shouldDraft) {
    console.log(`[SMS Post-Process] Generating draft for message ${message.id}`);

    const webhookDraftTimeoutMs =
      Number.parseInt(process.env.OPENAI_DRAFT_WEBHOOK_TIMEOUT_MS || "30000", 10) || 30_000;

    const draftResult = await generateResponseDraft(
      lead.id,
      transcript || `Lead: ${messageBody}`,
      newSentiment,
      "sms",
      {
        timeoutMs: webhookDraftTimeoutMs,
        triggerMessageId: message.id,
      }
    );

    if (draftResult.success && draftResult.draftId && draftResult.content) {
      const draftId = draftResult.draftId;
      const draftContent = draftResult.content;

      console.log(`[SMS Post-Process] Generated AI draft: ${draftId}`);

      const responseMode = lead.emailCampaign?.responseMode ?? null;
      const autoSendThreshold = lead.emailCampaign?.autoSendConfidenceThreshold ?? 0.9;

      // 8. Auto-Send Evaluation (EmailCampaign mode)
      if (responseMode === "AI_AUTO_SEND" && draftId && draftContent) {
        const evaluation = await evaluateAutoSend({
          clientId: client.id,
          leadId: lead.id,
          channel: "sms",
          latestInbound: messageBody,
          subject: null,
          conversationHistory: transcript || `Lead: ${messageBody}`,
          categorization: newSentiment,
          automatedReply: null,
          replyReceivedAt: messageSentAt,
          draft: draftContent,
        });

        if (evaluation.safeToSend && evaluation.confidence >= autoSendThreshold) {
          console.log(
            `[SMS Post-Process] Auto-sending draft ${draftId} for lead ${lead.id} (confidence ${evaluation.confidence.toFixed(2)} >= ${autoSendThreshold.toFixed(2)})`
          );

          const sendResult = await approveAndSendDraftSystem(draftId, { sentBy: "ai" });

          if (sendResult.success) {
            console.log(`[SMS Post-Process] Sent message: ${sendResult.messageId}`);
          } else {
            console.error(`[SMS Post-Process] Auto-send failed: ${sendResult.error}`);
          }
        } else {
          // Send Slack notification for review
          const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
          const campaignLabel = lead.emailCampaign
            ? `${lead.emailCampaign.name} (${lead.emailCampaign.bisonCampaignId})`
            : "Unknown campaign";
          const url = `${getPublicAppUrl()}/?view=inbox&leadId=${lead.id}`;
          const confidenceText = `${evaluation.confidence.toFixed(2)} < ${autoSendThreshold.toFixed(2)}`;

          const dmResult = await sendSlackDmByEmail({
            email: "jon@zeroriskgrowth.com",
            dedupeKey: `auto_send_review:${draftId}`,
            text: `AI auto-send review needed (${confidenceText})`,
            blocks: [
              { type: "header", text: { type: "plain_text", text: "AI Auto-Send: Review Needed", emoji: true } },
              {
                type: "section",
                fields: [
                  { type: "mrkdwn", text: `*Lead:*\n${leadName}${lead.email ? `\n${lead.email}` : ""}` },
                  { type: "mrkdwn", text: `*Campaign:*\n${campaignLabel}` },
                  { type: "mrkdwn", text: `*Sentiment:*\n${newSentiment || "Unknown"}` },
                  {
                    type: "mrkdwn",
                    text: `*Confidence:*\n${evaluation.confidence.toFixed(2)} (thresh ${autoSendThreshold.toFixed(2)})`,
                  },
                ],
              },
              { type: "section", text: { type: "mrkdwn", text: `*Reason:*\n${evaluation.reason}` } },
              {
                type: "section",
                text: { type: "mrkdwn", text: `*Draft Preview:*\n\`\`\`\n${draftContent.slice(0, 1400)}\n\`\`\`` },
              },
              { type: "section", text: { type: "mrkdwn", text: `<${url}|Open lead in dashboard>` } },
            ],
          });

          if (!dmResult.success) {
            console.error(`[Slack DM] Failed to notify Jon for draft ${draftId}: ${dmResult.error || "unknown error"}`);
          }

          console.log(`[SMS Post-Process] Auto-send blocked: ${evaluation.reason}`);
        }
      } else if (!lead.emailCampaign && lead.autoReplyEnabled && draftId) {
        // 9. Legacy per-lead auto-reply path (only when no EmailCampaign is present)
        const decision = await decideShouldAutoReply({
          clientId: client.id,
          leadId: lead.id,
          channel: "sms",
          latestInbound: messageBody,
          subject: null,
          conversationHistory: transcript || `Lead: ${messageBody}`,
          categorization: newSentiment,
          automatedReply: null,
          replyReceivedAt: messageSentAt,
        });

        if (!decision.shouldReply) {
          console.log(`[SMS Post-Process] Skipped auto-send for lead ${lead.id}: ${decision.reason}`);
        } else {
          console.log(`[SMS Post-Process] Auto-approving draft ${draftId} for lead ${lead.id}`);

          const sendResult = await approveAndSendDraftSystem(draftId, { sentBy: "ai" });

          if (sendResult.success) {
            console.log(`[SMS Post-Process] Sent message: ${sendResult.messageId}`);
          } else {
            console.error(`[SMS Post-Process] Failed to send draft: ${sendResult.error}`);
          }
        }
      }
    } else {
      console.error(`[SMS Post-Process] Failed to generate AI draft: ${draftResult.error}`);
    }
  } else {
    console.log(`[SMS Post-Process] Skipping draft generation (sentiment: ${newSentiment})`);
  }

  // 10. Update Lead Rollups
  // Ensure message counts and last message timestamps are up to date
  await bumpLeadMessageRollup({
    leadId: lead.id,
    direction: "inbound",
    sentAt: messageSentAt,
  });

  // 11. Slack Notification (Optional)
  // TODO: Implement Slack notifications - requires fetching user email from Supabase Auth
  // if (settings?.slackAlerts && lead.status === "Hot Lead") {
  //   const appUrl = getPublicAppUrl();
  //   const leadUrl = `${appUrl}/?clientId=${client.id}&leadId=${lead.id}`;
  //   await sendSlackDmByEmail({
  //     email: userEmail,
  //     text: `🔥 Hot lead replied via SMS: ${lead.firstName || "Unknown"} - ${leadUrl}`,
  //   });
  // }

  // 12. Enqueue lead scoring job (non-blocking, fire-and-forget)
  try {
    await enqueueLeadScoringJob({
      clientId: client.id,
      leadId: lead.id,
      messageId: message.id,
    });
  } catch (error) {
    // Don't fail the job if scoring enqueue fails
    console.error(`[SMS Post-Process] Failed to enqueue lead scoring job for lead ${lead.id}:`, error);
  }

  console.log(`[SMS Post-Process] Completed for message ${params.messageId}`);
}
