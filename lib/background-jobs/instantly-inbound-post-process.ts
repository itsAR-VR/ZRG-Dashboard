import "server-only";

import { prisma } from "@/lib/prisma";
import {
  analyzeInboundEmailReply,
  buildSentimentTranscriptFromMessages,
  classifySentiment,
  detectBounce,
  isOptOutText,
  isPositiveSentiment,
  SENTIMENT_TO_STATUS,
  type SentimentTag,
} from "@/lib/sentiment";
import { generateResponseDraft, shouldGenerateDraft } from "@/lib/ai-drafts";
import { approveAndSendDraftSystem } from "@/actions/message-actions";
import { autoStartMeetingRequestedSequenceIfEligible } from "@/lib/followup-automation";
import { evaluateAutoSend } from "@/lib/auto-send-evaluator";
import { decideShouldAutoReply } from "@/lib/auto-reply-gate";
import { pauseFollowUpsOnReply, pauseFollowUpsUntil, processMessageForAutoBooking, resumeAwaitingEnrichmentFollowUpsForLead } from "@/lib/followup-engine";
import { ensureLeadTimezone } from "@/lib/timezone-inference";
import { detectSnoozedUntilUtcFromMessage } from "@/lib/snooze-detection";
import { bumpLeadMessageRollup } from "@/lib/lead-message-rollups";
import { ensureGhlContactIdForLead, syncGhlContactPhoneForLead } from "@/lib/ghl-contacts";
import { sendSlackDmByEmail } from "@/lib/slack-dm";
import { getPublicAppUrl } from "@/lib/app-url";
import { enqueueLeadScoringJob } from "@/lib/lead-scoring";
import { maybeAssignLead } from "@/lib/lead-assignment";
import { scheduleDelayedAutoSend, getCampaignDelayConfig, validateDelayedAutoSend } from "@/lib/background-jobs/delayed-auto-send";

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

export async function runInstantlyInboundPostProcessJob(params: {
  clientId: string;
  leadId: string;
  messageId: string;
}): Promise<void> {
  console.log("[Instantly Post-Process] Starting for message", params.messageId);

  // Fetch message + lead + client + emailCampaign
  const message = await prisma.message.findUnique({
    where: { id: params.messageId },
    include: {
      lead: {
        include: {
          client: {
            select: {
              id: true,
              name: true,
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
    console.error("[Instantly Post-Process] Message not found:", params.messageId);
    return;
  }

  if (!message.lead) {
    console.error("[Instantly Post-Process] Lead not found for message:", params.messageId);
    return;
  }

  const lead = message.lead;
  const client = lead.client;
  const emailCampaign = lead.emailCampaign;

  // Skip outbound messages
  if (message.direction === "outbound") {
    console.log("[Instantly Post-Process] Skipping outbound message");
    return;
  }

  const messageBody = message.body || "";
  const rawText = message.rawText || messageBody;
  const subject = message.subject || null;
  const messageSentAt = message.sentAt || new Date();

  // 1. Build Conversation Transcript
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

  // 2. AI Sentiment Classification
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

  // 3. Update Lead Status & Sentiment
  await prisma.lead.update({
    where: { id: lead.id },
    data: { sentimentTag, status: leadStatus },
  });

  console.log("[Instantly Post-Process] Sentiment:", sentimentTag, "Status:", leadStatus);

  // 3b. Round-robin lead assignment (Phase 43)
  // Assign lead to next setter if sentiment is positive and not already assigned
  await maybeAssignLead({
    leadId: lead.id,
    clientId: client.id,
    sentimentTag,
  });

  // 4. Apply Auto Follow-Up Policy
  await applyAutoFollowUpPolicyOnInboundEmail({ clientId: client.id, leadId: lead.id, sentimentTag });

  // 5. Auto-Start Meeting Requested Sequence
  await autoStartMeetingRequestedSequenceIfEligible({
    leadId: lead.id,
    previousSentiment,
    newSentiment: sentimentTag,
  });

  // 6. Pause Follow-Ups on Reply
  await pauseFollowUpsOnReply(lead.id);

  // 7. Snooze Detection
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
      await prisma.lead.update({ where: { id: lead.id }, data: { snoozedUntil: snoozedUntilUtc } });
      await pauseFollowUpsUntil(lead.id, snoozedUntilUtc);
      console.log("[Instantly Post-Process] Snoozed until", snoozedUntilUtc.toISOString());
    }
  }

  // 8. Auto-Booking Check
  const autoBook = await processMessageForAutoBooking(lead.id, inboundText);
  if (autoBook.booked) {
    console.log("[Instantly Post-Process] Auto-booked appointment:", autoBook.appointmentId);
  }

  // 9. Blacklist/Automated Reply Handling
  if (sentimentTag === "Blacklist" || sentimentTag === "Automated Reply") {
    await prisma.aIDraft.updateMany({
      where: { leadId: lead.id, status: "pending" },
      data: { status: "rejected" },
    });
  }

  // 10. GHL Contact Sync (for positive sentiment)
  if (isPositiveSentiment(sentimentTag)) {
    ensureGhlContactIdForLead(lead.id, { allowCreateWithoutPhone: true })
      .then((res) => {
        if (!res.success) console.log("[GHL Contact] Lead", lead.id, res.error || "failed");
      })
      .catch(() => undefined);
    syncGhlContactPhoneForLead(lead.id).catch(() => undefined);
  }

  // 11. Resume Enrichment Follow-Ups
  resumeAwaitingEnrichmentFollowUpsForLead(lead.id).catch(() => undefined);

  // 12. AI Draft Generation
  if (!autoBook.booked && shouldGenerateDraft(sentimentTag, lead.email)) {
    console.log("[Instantly Post-Process] Generating draft for message", message.id);

    const webhookDraftTimeoutMs =
      Number.parseInt(process.env.OPENAI_DRAFT_WEBHOOK_TIMEOUT_MS || "30000", 10) || 30_000;

    const draftResult = await generateResponseDraft(
      lead.id,
      `Subject: ${subject ?? ""}\n\n${messageBody}`,
      sentimentTag,
      "email",
      { timeoutMs: webhookDraftTimeoutMs, triggerMessageId: message.id }
    );

    if (draftResult.success) {
      const draftId = draftResult.draftId;
      const draftContent = draftResult.content || undefined;

      const responseMode = emailCampaign?.responseMode ?? null;
      const autoSendThreshold = emailCampaign?.autoSendConfidenceThreshold ?? 0.9;

      // 13. EmailCampaign AI Auto-Send Path
      if (responseMode === "AI_AUTO_SEND" && draftId && draftContent) {
        const evaluation = await evaluateAutoSend({
          clientId: client.id,
          leadId: lead.id,
          channel: "email",
          latestInbound: messageBody,
          subject,
          conversationHistory: transcript,
          categorization: sentimentTag,
          automatedReply: null,
          replyReceivedAt: messageSentAt,
          draft: draftContent,
        });

        if (evaluation.safeToSend && evaluation.confidence >= autoSendThreshold) {
          console.log("[Instantly Post-Process] Auto-send approved for draft", draftId, "confidence", evaluation.confidence.toFixed(2));

          // Phase 47l: Check for delay configuration
          const delayConfig = emailCampaign?.id ? await getCampaignDelayConfig(emailCampaign.id) : null;

          if (delayConfig && (delayConfig.delayMinSeconds > 0 || delayConfig.delayMaxSeconds > 0)) {
            // Schedule delayed send
            const scheduleResult = await scheduleDelayedAutoSend({
              clientId: client.id,
              leadId: lead.id,
              triggerMessageId: message.id,
              draftId,
              delayMinSeconds: delayConfig.delayMinSeconds,
              delayMaxSeconds: delayConfig.delayMaxSeconds,
              inboundSentAt: messageSentAt,
            });

            if (scheduleResult.scheduled) {
              console.log("[Instantly Post-Process] Scheduled delayed send for draft", draftId, "runAt:", scheduleResult.runAt?.toISOString());
            } else {
              console.log("[Instantly Post-Process] Delayed send not scheduled:", scheduleResult.skipReason);
            }
          } else {
            // Immediate send (no delay configured)
            const validation = await validateDelayedAutoSend({
              leadId: lead.id,
              triggerMessageId: message.id,
              draftId,
            });
            if (!validation.proceed) {
              console.log(
                "[Instantly Post-Process] Skipping immediate auto-send for draft",
                draftId,
                validation.reason || "unknown_reason"
              );
            } else {
              const sendResult = await approveAndSendDraftSystem(draftId, { sentBy: "ai" });

              if (sendResult.success) {
                console.log("[Instantly Post-Process] Sent message:", sendResult.messageId);
              } else {
                console.error("[Instantly Post-Process] Auto-send failed:", sendResult.error);
              }
            }
          }
        } else {
          // Send Slack notification for review
          const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
          const campaignLabel = emailCampaign
            ? `${emailCampaign.name} (${emailCampaign.bisonCampaignId})`
            : "Unknown campaign";
          const url = `${getPublicAppUrl()}/?view=inbox&leadId=${lead.id}`;

          const dmResult = await sendSlackDmByEmail({
            email: "jon@zeroriskgrowth.com",
            dedupeKey: `auto_send_review:${draftId}`,
            text: `AI auto-send review needed (${evaluation.confidence.toFixed(2)} < ${autoSendThreshold.toFixed(2)})`,
            blocks: [
              { type: "header", text: { type: "plain_text", text: "AI Auto-Send: Review Needed", emoji: true } },
              {
                type: "section",
                fields: [
                  { type: "mrkdwn", text: `*Lead:*\n${leadName}${lead.email ? `\n${lead.email}` : ""}` },
                  { type: "mrkdwn", text: `*Campaign:*\n${campaignLabel}` },
                  { type: "mrkdwn", text: `*Sentiment:*\n${sentimentTag || "Unknown"}` },
                  {
                    type: "mrkdwn",
                    text: `*Confidence:*\n${evaluation.confidence.toFixed(2)} (thresh ${autoSendThreshold.toFixed(2)})`,
                  },
                ],
              },
              { type: "section", text: { type: "mrkdwn", text: `*Reason:*\n${evaluation.reason}` } },
              { type: "section", text: { type: "mrkdwn", text: `<${url}|Open lead in dashboard>` } },
            ],
          });

          if (!dmResult.success) {
            console.error("[Slack DM] Failed to notify Jon for draft", draftId, dmResult.error || "unknown error");
          }

          console.log("[Instantly Post-Process] Auto-send blocked:", evaluation.reason);
        }
      } else if (!emailCampaign && lead.autoReplyEnabled && draftId) {
        // 14. Legacy per-lead auto-reply path (only when no EmailCampaign is present)
        const decision = await decideShouldAutoReply({
          clientId: client.id,
          leadId: lead.id,
          channel: "email",
          latestInbound: messageBody,
          subject,
          conversationHistory: transcript,
          categorization: sentimentTag,
          automatedReply: null,
          replyReceivedAt: messageSentAt,
        });

        if (!decision.shouldReply) {
          console.log("[Instantly Post-Process] Skipped auto-send for lead", lead.id, decision.reason);
        } else {
          console.log("[Instantly Post-Process] Auto-approving draft", draftId, "for lead", lead.id);

          const sendResult = await approveAndSendDraftSystem(draftId, { sentBy: "ai" });

          if (sendResult.success) {
            console.log("[Instantly Post-Process] Sent message:", sendResult.messageId);
          } else {
            console.error("[Instantly Post-Process] Failed to send draft:", sendResult.error);
          }
        }
      } else {
        console.log("[Instantly Post-Process] Draft created:", draftId, "(no auto-send)");
      }
    } else {
      console.error("[Instantly Post-Process] Failed to generate AI draft:", draftResult.error);
    }
  } else {
    console.log("[Instantly Post-Process] Skipping draft generation (sentiment:", sentimentTag, "auto-booked:", autoBook.booked, ")");
  }

  // 15. Update Lead Rollups
  await bumpLeadMessageRollup({
    leadId: lead.id,
    direction: "inbound",
    sentAt: messageSentAt,
  });

  // 16. Enqueue lead scoring job (non-blocking, fire-and-forget)
  try {
    await enqueueLeadScoringJob({
      clientId: client.id,
      leadId: lead.id,
      messageId: message.id,
    });
  } catch (error) {
    // Don't fail the job if scoring enqueue fails
    console.error("[Instantly Post-Process] Failed to enqueue lead scoring job for lead", lead.id, error);
  }

  console.log("[Instantly Post-Process] Completed for message", params.messageId);
}
