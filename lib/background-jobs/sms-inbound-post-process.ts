import "server-only";

import { prisma } from "@/lib/prisma";
import { buildSentimentTranscriptFromMessages, classifySentiment, isPositiveSentiment, SENTIMENT_TO_STATUS } from "@/lib/sentiment";
import { generateResponseDraft, shouldGenerateDraft } from "@/lib/ai-drafts";
import { executeAutoSend } from "@/lib/auto-send";
import { pauseFollowUpsOnReply, pauseFollowUpsUntil, processMessageForAutoBooking } from "@/lib/followup-engine";
import { ensureLeadTimezone } from "@/lib/timezone-inference";
import { detectSnoozedUntilUtcFromMessage } from "@/lib/snooze-detection";
import { bumpLeadMessageRollup } from "@/lib/lead-message-rollups";
import { enqueueLeadScoringJob } from "@/lib/lead-scoring";
import { syncSmsConversationHistorySystem } from "@/lib/conversation-sync";
import { maybeAssignLead } from "@/lib/lead-assignment";
import { notifyOnLeadSentimentChange } from "@/lib/notification-center";
import { ensureCallRequestedTask } from "@/lib/call-requested";
import { extractSchedulerLinkFromText } from "@/lib/scheduling-link";
import { handleLeadSchedulerLinkIfPresent } from "@/lib/lead-scheduler-link";
import { upsertLeadCrmRowOnInterest } from "@/lib/lead-crm-row";
import { resolveBookingLink } from "@/lib/meeting-booking-provider";
import { detectActionSignals, EMPTY_ACTION_SIGNAL_RESULT, notifyActionSignals } from "@/lib/action-signal-detector";

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
              autoSendSkipHumanReview: true,
              autoSendScheduleMode: true,
              autoSendCustomSchedule: true,
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
  const schedulerLink = extractSchedulerLinkFromText(messageBody);
  if (schedulerLink) {
    prisma.lead
      .updateMany({
        where: { id: lead.id, externalSchedulingLink: { not: schedulerLink } },
        data: { externalSchedulingLink: schedulerLink, externalSchedulingLinkLastSeenAt: new Date() },
      })
      .catch(() => undefined);
  }

  // 1. Timezone Inference
  // SMS messages may contain timezone hints like "I'm in PST"
  await ensureLeadTimezone(lead.id, { conversationText: messageBody });

  // 2. Snooze Detection
  // If the lead asks to reconnect after a specific date, snooze/pause follow-ups until then.
  const inboundText = messageBody.trim();
  const snoozeKeywordHit =
    /\b(after|until|from)\b/i.test(inboundText) &&
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(inboundText);

  if (snoozeKeywordHit) {
    const tzResult = await ensureLeadTimezone(lead.id, { conversationText: inboundText });
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
    channel: "sms",
  });

  // 4. Pause Follow-Ups on Reply
  // Any inbound reply pauses active follow-up sequences
  await pauseFollowUpsOnReply(lead.id);

  // 5. Auto-Booking Check
  // If message indicates meeting acceptance, process booking
  const autoBook = await processMessageForAutoBooking(lead.id, messageBody, {
    channel: "sms",
    messageId: message.id,
    sentimentTag: finalSentiment,
  });
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

  notifyOnLeadSentimentChange({
    clientId: client.id,
    leadId: lead.id,
    previousSentimentTag: previousSentiment,
    newSentimentTag: newSentiment,
    messageId: message.id,
    latestInboundText: messageBody,
  }).catch(() => undefined);

  upsertLeadCrmRowOnInterest({
    leadId: lead.id,
    messageId: message.id,
    messageSentAt,
    channel: message.channel,
    sentimentTag: newSentiment,
  }).catch((error) => {
    console.warn(`[SMS Post-Process] Failed to upsert CRM row for lead ${lead.id}:`, error);
  });

  if (newSentiment === "Call Requested") {
    ensureCallRequestedTask({ leadId: lead.id, latestInboundText: messageBody }).catch(() => undefined);
  }

  handleLeadSchedulerLinkIfPresent({ leadId: lead.id, latestInboundText: messageBody }).catch(() => undefined);

  let actionSignals = EMPTY_ACTION_SIGNAL_RESULT;
  try {
    if (isPositiveSentiment(newSentiment)) {
      const workspaceBookingLink = await resolveBookingLink(client.id, null)
        .then((result) => result.bookingLink)
        .catch(() => null);
      actionSignals = await detectActionSignals({
        strippedText: inboundText,
        fullText: messageBody,
        sentimentTag: newSentiment,
        workspaceBookingLink,
        clientId: client.id,
        leadId: lead.id,
        channel: "sms",
        provider: "ghl",
        aiRouteBookingProcessEnabled: settings?.aiRouteBookingProcessEnabled ?? true,
      });
      if (actionSignals.signals.length > 0) {
        console.log("[SMS Post-Process] Action signals:", actionSignals.signals.map((signal) => signal.type).join(", "));
        notifyActionSignals({
          clientId: client.id,
          leadId: lead.id,
          messageId: message.id,
          signals: actionSignals.signals,
          latestInboundText: messageBody,
          route: actionSignals.route,
        }).catch((error) => console.warn("[SMS Post-Process] Action signal notify failed:", error));
      }
    }
  } catch (error) {
    console.warn("[SMS Post-Process] Action signal detection failed (non-fatal):", error);
  }

  // Phase 66: Removed sentiment-based Meeting Requested auto-start.
  // Meeting Requested is now triggered by setter email reply only
  // (see autoStartMeetingRequestedSequenceOnSetterEmailReply in lib/followup-automation.ts)

  // 7. AI Draft Generation
  // Skip if auto-booked or sentiment doesn't need draft
  const schedulingHandled = Boolean(autoBook.context?.followUpTaskCreated);
  if (schedulingHandled) {
    console.log("[SMS Post-Process] Skipping draft generation; scheduling follow-up task already created by auto-booking");
  }
  const shouldDraft = !autoBook.booked && !schedulingHandled && newSentiment && shouldGenerateDraft(newSentiment);

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
        autoBookingContext: autoBook.context?.schedulingDetected ? autoBook.context : null,
        actionSignals: actionSignals.signals.length > 0 || actionSignals.route ? actionSignals : null,
      }
    );

    if (draftResult.success && draftResult.draftId && draftResult.content) {
      const draftId = draftResult.draftId;
      const draftContent = draftResult.content;
      const leadAutoSendContext = await prisma.lead.findUnique({
        where: { id: lead.id },
        select: {
          offeredSlots: true,
          externalSchedulingLink: true,
        },
      });
      const offeredSlots = (() => {
        if (!leadAutoSendContext?.offeredSlots) return [];
        try {
          const parsed = JSON.parse(leadAutoSendContext.offeredSlots);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })();
      const workspaceBookingLink = await resolveBookingLink(client.id, null)
        .then((result) => result.bookingLink)
        .catch(() => null);

      console.log(`[SMS Post-Process] Generated AI draft: ${draftId}`);

      const autoSendResult = await executeAutoSend({
        clientId: client.id,
        leadId: lead.id,
        triggerMessageId: message.id,
        draftId,
        draftContent,
        draftPipelineRunId: draftResult.runId ?? null,
        channel: "sms",
        latestInbound: messageBody,
        subject: null,
        conversationHistory: transcript || `Lead: ${messageBody}`,
        sentimentTag: newSentiment,
        messageSentAt,
        automatedReply: null,
        leadFirstName: lead.firstName,
        leadLastName: lead.lastName,
        leadEmail: lead.email,
        leadTimezone: lead.timezone ?? null,
        offeredSlots,
        bookingLink: workspaceBookingLink,
        leadSchedulerLink: leadAutoSendContext?.externalSchedulingLink ?? null,
        emailCampaign: lead.emailCampaign,
        autoReplyEnabled: lead.autoReplyEnabled,
        workspaceSettings: settings,
        validateImmediateSend: true,
        includeDraftPreviewInSlack: true,
      });

      if (
        autoSendResult.mode === "AI_AUTO_SEND" &&
        typeof autoSendResult.telemetry.confidence === "number" &&
        typeof autoSendResult.telemetry.threshold === "number" &&
        autoSendResult.telemetry.confidence >= autoSendResult.telemetry.threshold
      ) {
        console.log(
          `[SMS Post-Process] Auto-send approved for draft ${draftId} (confidence ${autoSendResult.telemetry.confidence.toFixed(2)} >= ${autoSendResult.telemetry.threshold.toFixed(2)})`
        );
      }

      switch (autoSendResult.outcome.action) {
        case "send_delayed": {
          console.log(
            `[SMS Post-Process] Scheduled delayed send for draft ${draftId}, runAt: ${autoSendResult.outcome.runAt.toISOString()}`
          );
          break;
        }
        case "send_immediate": {
          console.log(`[SMS Post-Process] Sent message: ${autoSendResult.outcome.messageId}`);
          break;
        }
        case "needs_review": {
          if (!autoSendResult.outcome.slackDm.sent && !autoSendResult.outcome.slackDm.skipped) {
            console.error(
              `[Slack DM] Failed to notify Slack reviewers for draft ${draftId}: ${autoSendResult.outcome.slackDm.error || "unknown error"}`
            );
          }
          console.log(`[SMS Post-Process] Auto-send blocked: ${autoSendResult.outcome.reason}`);
          break;
        }
        case "skip": {
          if (autoSendResult.telemetry.delayedScheduleSkipReason) {
            console.log(`[SMS Post-Process] Delayed send not scheduled: ${autoSendResult.telemetry.delayedScheduleSkipReason}`);
          } else if (autoSendResult.telemetry.immediateValidationSkipReason) {
            console.log(
              `[SMS Post-Process] Skipping immediate auto-send for draft ${draftId}: ${autoSendResult.telemetry.immediateValidationSkipReason}`
            );
          } else if (autoSendResult.mode === "LEGACY_AUTO_REPLY") {
            const legacyReason = autoSendResult.outcome.reason.replace(/^legacy_auto_reply_skip:/, "");
            console.log(`[SMS Post-Process] Skipped auto-send for lead ${lead.id}: ${legacyReason}`);
          }
          break;
        }
        case "error": {
          if (autoSendResult.mode === "AI_AUTO_SEND") {
            console.error(`[SMS Post-Process] Auto-send failed: ${autoSendResult.outcome.error}`);
          } else {
            console.error(`[SMS Post-Process] Failed to send draft: ${autoSendResult.outcome.error}`);
          }
          break;
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
