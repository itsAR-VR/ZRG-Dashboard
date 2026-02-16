import "server-only";

import { prisma } from "@/lib/prisma";
import {
  analyzeInboundEmailReply,
  buildSentimentTranscriptFromMessages,
  classifySentiment,
  detectBounce,
  isAutoBookingBlockedSentiment,
  isOptOutText,
  isPositiveSentiment,
  SENTIMENT_TO_STATUS,
  type SentimentTag,
} from "@/lib/sentiment";
import { generateResponseDraft, shouldGenerateDraft } from "@/lib/ai-drafts";
import { executeAutoSend } from "@/lib/auto-send";
import {
  pauseFollowUpsOnReply,
  pauseFollowUpsUntil,
  processMessageForAutoBooking,
  resumeAwaitingEnrichmentFollowUpsForLead,
} from "@/lib/followup-engine";
import { ensureLeadTimezone } from "@/lib/timezone-inference";
import { detectSnoozedUntilUtcFromMessage } from "@/lib/snooze-detection";
import { bumpLeadMessageRollup } from "@/lib/lead-message-rollups";
import { ensureGhlContactIdForLead, syncGhlContactPhoneForLead } from "@/lib/ghl-contacts";
import { enqueueLeadScoringJob } from "@/lib/lead-scoring";
import { maybeAssignLead } from "@/lib/lead-assignment";
import { notifyOnLeadSentimentChange } from "@/lib/notification-center";
import { ensureCallRequestedTask } from "@/lib/call-requested";
import { markInboxCountsDirty } from "@/lib/inbox-counts-dirty";
import { extractSchedulerLinkFromText } from "@/lib/scheduling-link";
import { detectActionSignals, notifyActionSignals, EMPTY_ACTION_SIGNAL_RESULT } from "@/lib/action-signal-detector";
import { resolveBookingLink } from "@/lib/meeting-booking-provider";
import { handleLeadSchedulerLinkIfPresent } from "@/lib/lead-scheduler-link";
import { upsertLeadCrmRowOnInterest } from "@/lib/lead-crm-row";
import { stripEmailQuotedSectionsForAutomation } from "@/lib/email-cleaning";
import type { InboundPostProcessParams, InboundPostProcessResult, InboundPostProcessPipelineStage } from "@/lib/inbound-post-process/types";

function mapInboxClassificationToSentimentTag(classification: string): SentimentTag {
  switch (classification) {
    case "Meeting Booked":
      return "Meeting Booked";
    case "Meeting Requested":
      return "Meeting Requested";
    case "Call Requested":
      return "Call Requested";
    case "Information Requested":
      return "Information Requested";
    case "Objection":
      return "Objection";
    case "Follow Up":
      return "Follow Up";
    case "Not Interested":
      return "Not Interested";
    case "Automated Reply":
      return "Automated Reply";
    case "Out Of Office":
      return "Out of Office";
    case "Blacklist":
      return "Blacklist";
    default:
      return "Neutral";
  }
}

async function applyAutoFollowUpPolicyOnInboundEmail(opts: { clientId: string; leadId: string; sentimentTag: string | null }) {
  if (!isPositiveSentiment(opts.sentimentTag)) {
    await prisma.lead.updateMany({
      where: { id: opts.leadId, enrichmentStatus: "pending" },
      data: { enrichmentStatus: "not_needed" },
    });
    return;
  }

  const settings = await prisma.workspaceSettings.findUnique({
    where: { clientId: opts.clientId },
    select: { autoFollowUpsOnReply: true },
  });
  if (!settings?.autoFollowUpsOnReply) return;

  await prisma.lead.updateMany({
    where: { id: opts.leadId, autoFollowUpEnabled: false },
    data: { autoFollowUpEnabled: true },
  });
}

export async function runInboundPostProcessPipeline(params: InboundPostProcessParams): Promise<InboundPostProcessResult> {
  const stageLogs: InboundPostProcessPipelineStage[] = [];
  const prefix = params.adapter.logPrefix;

  const pushStage = (stage: InboundPostProcessPipelineStage) => {
    stageLogs.push(stage);
  };

  console.log(prefix, "Starting for message", params.messageId);

  pushStage("load");
  const message = await prisma.message.findUnique({
    where: { id: params.messageId },
    include: {
      lead: {
        include: {
          client: {
            select: {
              id: true,
              name: true,
              settings: {
                select: {
                  timezone: true,
                  workStartTime: true,
                  workEndTime: true,
                  autoSendSkipHumanReview: true,
                  autoSendScheduleMode: true,
                  autoSendCustomSchedule: true,
                  autoSendRevisionEnabled: true,
                  autoSendRevisionModel: true,
                  autoSendRevisionReasoningEffort: true,
                  autoSendRevisionMaxIterations: true,
                  aiRouteBookingProcessEnabled: true,
                },
              },
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
    console.error(prefix, "Message not found:", params.messageId);
    return { stageLogs };
  }

  if (!message.lead) {
    console.error(prefix, "Lead not found for message:", params.messageId);
    return { stageLogs };
  }

  const lead = message.lead;
  const client = lead.client;
  const emailCampaign = lead.emailCampaign;

  if (message.direction === "outbound") {
    console.log(prefix, "Skipping outbound message");
    return { stageLogs };
  }

  const messageBody = message.body || "";
  const rawText = message.rawText || messageBody;
  const subject = message.subject || null;
  const messageSentAt = message.sentAt || new Date();

  const schedulerLink = extractSchedulerLinkFromText(rawText);
  if (schedulerLink) {
    prisma.lead
      .updateMany({
        where: { id: lead.id, externalSchedulingLink: { not: schedulerLink } },
        data: { externalSchedulingLink: schedulerLink, externalSchedulingLinkLastSeenAt: new Date() },
      })
      .catch(() => undefined);
  }

  pushStage("build_transcript");
  const contextMessages = await prisma.message.findMany({
    where: { leadId: lead.id },
    orderBy: { sentAt: "desc" },
    take: 40,
    select: { sentAt: true, channel: true, direction: true, body: true, subject: true },
  });

  const transcript = buildSentimentTranscriptFromMessages([
    ...contextMessages.reverse(),
    { sentAt: messageSentAt, channel: "email", direction: "inbound", body: messageBody, subject },
  ]);

  pushStage("classify_sentiment");
  const previousSentiment = lead.sentimentTag;

  const inboundCombinedForSafety = `Subject: ${subject ?? ""} | ${messageBody}`;
  const mustBlacklist =
    isOptOutText(inboundCombinedForSafety) ||
    detectBounce([{ body: inboundCombinedForSafety, direction: "inbound", channel: "email" }]);

  let sentimentTag: SentimentTag;
  if (mustBlacklist) {
    sentimentTag = "Blacklist";
  } else {
    const analysis = await analyzeInboundEmailReply({
      clientId: client.id,
      leadId: lead.id,
      clientName: client.name,
      lead: {
        first_name: lead.firstName ?? null,
        last_name: lead.lastName ?? null,
        email: lead.email ?? null,
        time_received: messageSentAt.toISOString(),
      },
      subject,
      body_text: rawText,
      provider_cleaned_text: messageBody,
      entire_conversation_thread_html: null,
      automated_reply: null,
      conversation_transcript: transcript,
    });

    if (analysis) {
      sentimentTag = mapInboxClassificationToSentimentTag(analysis.classification);
    } else {
      sentimentTag = await classifySentiment(transcript, { clientId: client.id, leadId: lead.id });
    }
  }

  const leadStatus = SENTIMENT_TO_STATUS[sentimentTag] || lead.status || "new";

  pushStage("update_lead");
  await prisma.lead.update({
    where: { id: lead.id },
    data: { sentimentTag, status: leadStatus },
  });
  await markInboxCountsDirty(client.id).catch(() => undefined);

  console.log(prefix, "Sentiment:", sentimentTag, "Status:", leadStatus);

  notifyOnLeadSentimentChange({
    clientId: client.id,
    leadId: lead.id,
    previousSentimentTag: previousSentiment,
    newSentimentTag: sentimentTag,
    messageId: message.id,
    latestInboundText: messageBody,
  }).catch(() => undefined);

  upsertLeadCrmRowOnInterest({
    leadId: lead.id,
    messageId: message.id,
    messageSentAt,
    channel: message.channel,
    sentimentTag,
  }).catch((error) => {
    console.warn(prefix, "Failed to upsert CRM row for lead", lead.id, error);
  });

  if (sentimentTag === "Call Requested") {
    ensureCallRequestedTask({ leadId: lead.id, latestInboundText: messageBody }).catch(() => undefined);
  }

  handleLeadSchedulerLinkIfPresent({ leadId: lead.id, latestInboundText: messageBody }).catch(() => undefined);

  pushStage("maybe_assign_lead");
  await maybeAssignLead({
    leadId: lead.id,
    clientId: client.id,
    sentimentTag,
    channel: "email",
  });

  pushStage("apply_auto_followup_policy");
  await applyAutoFollowUpPolicyOnInboundEmail({ clientId: client.id, leadId: lead.id, sentimentTag });

  // Phase 66: Removed sentiment-based Meeting Requested auto-start.
  // Meeting Requested is now triggered by setter email reply only
  // (see autoStartMeetingRequestedSequenceOnSetterEmailReply in lib/followup-automation.ts)

  pushStage("pause_followups_on_reply");
  await pauseFollowUpsOnReply(lead.id);

  pushStage("snooze_detection");
  const inboundText = messageBody.trim();
  const inboundReplyOnly = stripEmailQuotedSectionsForAutomation(inboundText).trim();
  const snoozeKeywordHit =
    /\b(after|until|from)\b/i.test(inboundReplyOnly) &&
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(inboundReplyOnly);

  if (snoozeKeywordHit) {
      const tzResult = await ensureLeadTimezone(lead.id);
      const { snoozedUntilUtc, confidence } = detectSnoozedUntilUtcFromMessage({
        messageText: inboundReplyOnly,
        timeZone: tzResult.timezone || "UTC",
      });

    if (snoozedUntilUtc && confidence >= 0.95) {
      await prisma.lead.update({ where: { id: lead.id }, data: { snoozedUntil: snoozedUntilUtc } });
      await pauseFollowUpsUntil(lead.id, snoozedUntilUtc);
      console.log(prefix, "Snoozed until", snoozedUntilUtc.toISOString());
    }
  }

  pushStage("auto_booking");
  const skipAutoBook = isAutoBookingBlockedSentiment(sentimentTag);
  const autoBook = !skipAutoBook && inboundReplyOnly
    ? await processMessageForAutoBooking(lead.id, inboundReplyOnly, {
        channel: "email",
        messageId: message.id,
        sentimentTag,
      })
    : ({
        booked: false as const,
        context: {
          schedulingDetected: false,
          schedulingIntent: null,
          clarificationTaskCreated: false,
          clarificationMessage: null,
          followUpTaskCreated: false,
          followUpTaskKind: null,
          qualificationEvaluated: false,
          isQualifiedForBooking: null,
          qualificationReason: null,
          failureReason: "disabled",
          route: null,
          matchStrategy: null,
        },
      } as const);
  if (autoBook.booked) {
    console.log(prefix, "Auto-booked appointment:", autoBook.appointmentId);
  }

  pushStage("reject_pending_drafts");
  if (sentimentTag === "Blacklist" || sentimentTag === "Automated Reply") {
    await prisma.aIDraft.updateMany({
      where: { leadId: lead.id, status: "pending" },
      data: { status: "rejected" },
    });
  }

  pushStage("ghl_contact_sync");
  if (isPositiveSentiment(sentimentTag)) {
    ensureGhlContactIdForLead(lead.id, { allowCreateWithoutPhone: true })
      .then((res) => {
        if (!res.success) console.log("[GHL Contact] Lead", lead.id, res.error || "failed");
      })
      .catch(() => undefined);
    syncGhlContactPhoneForLead(lead.id).catch(() => undefined);
  }

  pushStage("resume_enrichment_followups");
  resumeAwaitingEnrichmentFollowUpsForLead(lead.id).catch(() => undefined);

  // Action signal detection (Phase 143) — detect call requests + external calendar links
  pushStage("action_signal_detection");
  let actionSignals = EMPTY_ACTION_SIGNAL_RESULT;
  try {
    if (isPositiveSentiment(sentimentTag)) {
      const workspaceBookingLink = await resolveBookingLink(client.id, null)
        .then((r) => r.bookingLink)
        .catch(() => null);
      actionSignals = await detectActionSignals({
        strippedText: inboundReplyOnly,
        fullText: rawText,
        sentimentTag,
        workspaceBookingLink,
        clientId: client.id,
        leadId: lead.id,
        channel: params.adapter.channel,
        provider: params.adapter.provider,
        aiRouteBookingProcessEnabled: client.settings?.aiRouteBookingProcessEnabled ?? true,
      });
      if (actionSignals.signals.length > 0) {
        console.log(prefix, "Action signals:", actionSignals.signals.map((s) => s.type).join(", "));
        notifyActionSignals({
          clientId: client.id,
          leadId: lead.id,
          messageId: message.id,
          signals: actionSignals.signals,
          latestInboundText: messageBody,
          route: actionSignals.route,
        }).catch((err) => console.warn(prefix, "Action signal notify failed:", err));
      }
    }
  } catch (err) {
    console.warn(prefix, "Action signal detection failed (non-fatal):", err);
  }

  pushStage("draft_generation");
  const schedulingHandled = Boolean(autoBook.context?.followUpTaskCreated);
  if (schedulingHandled) {
    console.log(prefix, "Skipping draft generation; scheduling follow-up task already created by auto-booking");
  }

  if (!autoBook.booked && !schedulingHandled && shouldGenerateDraft(sentimentTag, lead.email)) {
    console.log(prefix, "Generating draft for message", message.id);

    const webhookDraftTimeoutMs = Number.parseInt(process.env.OPENAI_DRAFT_WEBHOOK_TIMEOUT_MS || "30000", 10) || 30_000;

    const draftResult = await generateResponseDraft(
      lead.id,
      `Subject: ${subject ?? ""}\n\n${messageBody}`,
      sentimentTag,
      "email",
      {
        timeoutMs: webhookDraftTimeoutMs,
        triggerMessageId: message.id,
        autoBookingContext: autoBook.context?.schedulingDetected ? autoBook.context : null,
        actionSignals: actionSignals.signals.length > 0 || actionSignals.route ? actionSignals : null,
      }
    );

    if (draftResult.success) {
      const draftId = draftResult.draftId;
      if (!draftId) {
        console.log(prefix, "Draft created:", draftId, "(no auto-send)");
      } else {
        const workspaceBookingLink = await resolveBookingLink(client.id, null)
          .then((result) => result.bookingLink)
          .catch(() => null);
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

        const autoSendResult = await executeAutoSend({
          clientId: client.id,
          leadId: lead.id,
          triggerMessageId: message.id,
          draftId,
          draftContent: draftResult.content || "",
          draftPipelineRunId: draftResult.runId ?? null,
          channel: "email",
          latestInbound: messageBody,
          subject,
          conversationHistory: transcript,
          sentimentTag,
          messageSentAt,
          automatedReply: null,
          leadFirstName: lead.firstName,
          leadLastName: lead.lastName,
          leadEmail: lead.email,
          leadTimezone: lead.timezone ?? null,
          offeredSlots,
          bookingLink: workspaceBookingLink,
          leadSchedulerLink: leadAutoSendContext?.externalSchedulingLink ?? null,
          emailCampaign,
          autoReplyEnabled: lead.autoReplyEnabled,
          workspaceSettings: lead.client?.settings ?? null,
          validateImmediateSend: true,
          includeDraftPreviewInSlack: false,
        });

        if (
          autoSendResult.mode === "AI_AUTO_SEND" &&
          typeof autoSendResult.telemetry.confidence === "number" &&
          typeof autoSendResult.telemetry.threshold === "number" &&
          autoSendResult.telemetry.confidence >= autoSendResult.telemetry.threshold
        ) {
          console.log(prefix, "Auto-send approved for draft", draftId, "confidence", autoSendResult.telemetry.confidence.toFixed(2));
        }

        if (
          autoSendResult.mode === "DISABLED" ||
          (autoSendResult.outcome.action === "skip" && autoSendResult.outcome.reason === "missing_draft_content")
        ) {
          console.log(prefix, "Draft created:", draftId, "(no auto-send)");
        } else {
          switch (autoSendResult.outcome.action) {
            case "send_delayed": {
              console.log(prefix, "Scheduled delayed send for draft", draftId, "runAt:", autoSendResult.outcome.runAt.toISOString());
              break;
            }
            case "send_immediate": {
              console.log(prefix, "Sent message:", autoSendResult.outcome.messageId);
              break;
            }
            case "needs_review": {
              if (!autoSendResult.outcome.slackDm.sent && !autoSendResult.outcome.slackDm.skipped) {
                console.error(
                  "[Slack DM] Failed to notify Slack reviewers for draft",
                  draftId,
                  autoSendResult.outcome.slackDm.error || "unknown error"
                );
              }
              console.log(prefix, "Auto-send blocked:", autoSendResult.outcome.reason);
              break;
            }
            case "skip": {
              if (autoSendResult.telemetry.delayedScheduleSkipReason) {
                console.log(prefix, "Delayed send not scheduled:", autoSendResult.telemetry.delayedScheduleSkipReason);
              } else if (autoSendResult.telemetry.immediateValidationSkipReason) {
                console.log(prefix, "Skipping immediate auto-send for draft", draftId, autoSendResult.telemetry.immediateValidationSkipReason);
              } else if (autoSendResult.mode === "LEGACY_AUTO_REPLY") {
                const legacyReason = autoSendResult.outcome.reason.replace(/^legacy_auto_reply_skip:/, "");
                console.log(prefix, "Skipped auto-send for lead", lead.id, legacyReason);
              }
              break;
            }
            case "error": {
              if (autoSendResult.mode === "AI_AUTO_SEND") {
                console.error(prefix, "Auto-send failed:", autoSendResult.outcome.error);
              } else {
                console.error(prefix, "Failed to send draft:", autoSendResult.outcome.error);
              }
              break;
            }
          }
        }
      }
    } else {
      console.error(prefix, "Failed to generate AI draft:", draftResult.error);
    }
  } else {
    console.log(prefix, "Skipping draft generation (sentiment:", sentimentTag, "auto-booked:", autoBook.booked, ")");
  }

  pushStage("bump_rollups");
  await bumpLeadMessageRollup({
    leadId: lead.id,
    direction: "inbound",
    sentAt: messageSentAt,
  });

  pushStage("enqueue_lead_scoring");
  try {
    await enqueueLeadScoringJob({
      clientId: client.id,
      leadId: lead.id,
      messageId: message.id,
    });
  } catch (error) {
    console.error(prefix, "Failed to enqueue lead scoring job for lead", lead.id, error);
  }

  console.log(prefix, "Completed for message", params.messageId);
  return { stageLogs };
}
