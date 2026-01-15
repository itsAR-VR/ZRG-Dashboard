import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findOrCreateLead } from "@/lib/lead-matching";
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
import { autoStartMeetingRequestedSequenceIfEligible, autoStartNoResponseSequenceOnOutbound } from "@/lib/followup-automation";
import { decideShouldAutoReply } from "@/lib/auto-reply-gate";
import { evaluateAutoSend } from "@/lib/auto-send-evaluator";
import { pauseFollowUpsOnReply, pauseFollowUpsUntil, processMessageForAutoBooking, resumeAwaitingEnrichmentFollowUpsForLead } from "@/lib/followup-engine";
import { ensureLeadTimezone } from "@/lib/timezone-inference";
import { detectSnoozedUntilUtcFromMessage } from "@/lib/snooze-detection";
import { bumpLeadMessageRollup } from "@/lib/lead-message-rollups";
import { getPublicAppUrl } from "@/lib/app-url";
import { sendSlackDmByEmail } from "@/lib/slack-dm";
import { ensureGhlContactIdForLead, syncGhlContactPhoneForLead } from "@/lib/ghl-contacts";
import { EmailIntegrationProvider } from "@prisma/client";
import { resolveEmailIntegrationProvider } from "@/lib/email-integration";
import { encodeInstantlyReplyHandle } from "@/lib/email-reply-handle";

// Vercel Serverless Functions (Pro) require maxDuration in [1, 800].
export const maxDuration = 800;

const WEBHOOK_DRAFT_TIMEOUT_MS =
  Number.parseInt(process.env.OPENAI_DRAFT_WEBHOOK_TIMEOUT_MS || "30000", 10) || 30_000;

type InstantlyWebhookPayload = {
  type?: string;
  timestamp?: number;
  campaign_id?: string;
  campaign_name?: string;
  contact_email?: string;
  contact_name?: string;
  email_id?: string; // used as reply_to_uuid when replying
  email_account?: string; // used as eaccount when replying
  reply_subject?: string | null;
  reply_text?: string | null;
  reply_html?: string | null;
  email_subject?: string | null;
  email_text?: string | null;
  email_html?: string | null;
};

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseEpochToDate(value: unknown): Date {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(ms);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return new Date();
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) {
      const ms = asNumber > 1_000_000_000_000 ? asNumber : asNumber * 1000;
      return new Date(ms);
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function splitName(fullName: string | null): { firstName: string | null; lastName: string | null } {
  const trimmed = (fullName || "").trim();
  if (!trimmed) return { firstName: null, lastName: null };
  const parts = trimmed.split(/\s+/g);
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") || null };
}

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

function isAuthorizedInstantlyWebhook(request: NextRequest, expected: string | null): boolean {
  if (!expected) return false;

  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme === "Bearer" && token && token === expected) return true;

  const headerSecret = request.headers.get("x-instantly-secret") ?? request.headers.get("x-webhook-secret");
  if (headerSecret && headerSecret === expected) return true;

  return false;
}

async function findClientById(clientId: string) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      emailProvider: true,
      instantlyApiKey: true,
      instantlyWebhookSecret: true,
      emailBisonApiKey: true,
      emailBisonWorkspaceId: true,
      smartLeadApiKey: true,
      smartLeadWebhookSecret: true,
    },
  });
  return client;
}

export async function POST(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const clientId = url.searchParams.get("clientId")?.trim() || "";
    if (!clientId) {
      return NextResponse.json({ error: "Missing clientId" }, { status: 400 });
    }

    const client = await findClientById(clientId);
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    let provider: EmailIntegrationProvider | null;
    try {
      provider = resolveEmailIntegrationProvider(client);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid email integration configuration" },
        { status: 409 }
      );
    }

    if (provider !== EmailIntegrationProvider.INSTANTLY) {
      console.warn(`[Instantly Webhook] Ignored: client ${clientId} provider is ${provider || "none"}`);
      return NextResponse.json({ success: true, ignored: true, reason: "provider_mismatch" });
    }

    const expectedSecret = client.instantlyWebhookSecret || null;
    if (!isAuthorizedInstantlyWebhook(request, expectedSecret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = (await request.json().catch(() => null)) as InstantlyWebhookPayload | null;
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const eventType = normalizeOptionalString(payload.type) || "unknown";

    if (eventType === "reply_received") {
      const leadEmail = normalizeOptionalString(payload.contact_email);
      const replyToUuid = normalizeOptionalString(payload.email_id);
      const eaccount = normalizeOptionalString(payload.email_account);
      if (!leadEmail || !replyToUuid || !eaccount) {
        return NextResponse.json({ error: "Missing contact_email, email_id, or email_account" }, { status: 400 });
      }

      const sentAt = parseEpochToDate(payload.timestamp);

      const replyHandle = encodeInstantlyReplyHandle({
        replyToUuid,
        eaccount,
        eventTimestamp: sentAt.getTime(),
      });

      const existingMessage = await prisma.message.findUnique({
        where: { emailBisonReplyId: replyHandle },
        select: { id: true },
      });
      if (existingMessage) {
        return NextResponse.json({ success: true, deduped: true, eventType });
      }

      const campaignId = normalizeOptionalString(payload.campaign_id);
      const campaignName = normalizeOptionalString(payload.campaign_name);
      const emailCampaign = campaignId
        ? await prisma.emailCampaign.upsert({
            where: { clientId_bisonCampaignId: { clientId: client.id, bisonCampaignId: campaignId } },
            create: { clientId: client.id, bisonCampaignId: campaignId, name: campaignName || `Campaign ${campaignId}` },
            update: { name: campaignName || `Campaign ${campaignId}` },
          })
        : null;

      const { firstName, lastName } = splitName(normalizeOptionalString(payload.contact_name));
      const leadResult = await findOrCreateLead(
        client.id,
        { email: leadEmail, firstName, lastName },
        undefined,
        emailCampaign ? { emailCampaignId: emailCampaign.id } : undefined
      );
      const lead = leadResult.lead;

      const subject = normalizeOptionalString(payload.reply_subject) ?? null;
      const rawText = normalizeOptionalString(payload.reply_text);
      const rawHtml = normalizeOptionalString(payload.reply_html);
      const cleanedBody = (rawText || rawHtml || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

      const contextMessages = await prisma.message.findMany({
        where: { leadId: lead.id },
        orderBy: { sentAt: "desc" },
        take: 40,
        select: { sentAt: true, channel: true, direction: true, body: true, subject: true },
      });

      const transcript = buildSentimentTranscriptFromMessages([
        ...contextMessages.reverse(),
        { sentAt, channel: "email", direction: "inbound", body: cleanedBody, subject },
      ]);

      const previousSentiment = lead.sentimentTag;

      const inboundCombinedForSafety = `Subject: ${subject ?? ""} | ${cleanedBody}`;
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
            time_received: sentAt.toISOString(),
          },
          subject,
          body_text: rawText,
          provider_cleaned_text: cleanedBody,
          entire_conversation_thread_html: rawHtml,
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

      await prisma.message.create({
        data: {
          emailBisonReplyId: replyHandle,
          channel: "email",
          source: "zrg",
          body: cleanedBody,
          rawText,
          rawHtml,
          subject,
          cc: [],
          bcc: [],
          isRead: false,
          direction: "inbound",
          leadId: lead.id,
          sentAt,
        },
      });

      await bumpLeadMessageRollup({ leadId: lead.id, direction: "inbound", sentAt });

      await prisma.lead.update({
        where: { id: lead.id },
        data: { sentimentTag, status: leadStatus },
      });

      await applyAutoFollowUpPolicyOnInboundEmail({ clientId: client.id, leadId: lead.id, sentimentTag });

      await autoStartMeetingRequestedSequenceIfEligible({
        leadId: lead.id,
        previousSentiment,
        newSentiment: sentimentTag,
      });

      pauseFollowUpsOnReply(lead.id).catch((err) => console.error("[Instantly Webhook] pauseFollowUpsOnReply error:", err));

      const inboundText = cleanedBody.trim();
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
        }
      }

      const autoBook = await processMessageForAutoBooking(lead.id, inboundText);

      if (sentimentTag === "Blacklist" || sentimentTag === "Automated Reply") {
        await prisma.aIDraft.updateMany({
          where: { leadId: lead.id, status: "pending" },
          data: { status: "rejected" },
        });
      }

      if (isPositiveSentiment(sentimentTag)) {
        ensureGhlContactIdForLead(lead.id, { allowCreateWithoutPhone: true })
          .then((res) => {
            if (!res.success) console.log(`[GHL Contact] Lead ${lead.id}: ${res.error || "failed"}`);
          })
          .catch(() => undefined);
        syncGhlContactPhoneForLead(lead.id).catch(() => undefined);
      }

      resumeAwaitingEnrichmentFollowUpsForLead(lead.id).catch(() => undefined);

      let draftId: string | undefined;
      let draftContent: string | undefined;
      let autoReplySent = false;

      if (!autoBook.booked && shouldGenerateDraft(sentimentTag, leadEmail)) {
        const draftResult = await generateResponseDraft(
          lead.id,
          `Subject: ${subject ?? ""}\n\n${cleanedBody}`,
          sentimentTag,
          "email",
          { timeoutMs: WEBHOOK_DRAFT_TIMEOUT_MS }
        );

        if (draftResult.success) {
          draftId = draftResult.draftId;
          draftContent = draftResult.content || undefined;

          const responseMode = emailCampaign?.responseMode ?? null;
          const autoSendThreshold = emailCampaign?.autoSendConfidenceThreshold ?? 0.9;

          if (responseMode === "AI_AUTO_SEND" && draftId && draftContent) {
            const evaluation = await evaluateAutoSend({
              clientId: client.id,
              leadId: lead.id,
              channel: "email",
              latestInbound: cleanedBody,
              subject: subject ?? null,
              conversationHistory: transcript,
              categorization: sentimentTag,
              automatedReply: null,
              replyReceivedAt: sentAt,
              draft: draftContent,
            });

            if (evaluation.safeToSend && evaluation.confidence >= autoSendThreshold) {
              const sendResult = await approveAndSendDraftSystem(draftId, { sentBy: "ai" });
              if (sendResult.success) autoReplySent = true;
            } else {
              const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
              const campaignLabel = emailCampaign ? `${emailCampaign.name} (${emailCampaign.bisonCampaignId})` : "Unknown campaign";
              const url = `${getPublicAppUrl()}/?view=inbox&leadId=${lead.id}`;
              const confidenceText = `${evaluation.confidence.toFixed(2)} < ${autoSendThreshold.toFixed(2)}`;

              sendSlackDmByEmail({
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
                      { type: "mrkdwn", text: `*Sentiment:*\n${sentimentTag || "Unknown"}` },
                      { type: "mrkdwn", text: `*Confidence:*\n${evaluation.confidence.toFixed(2)} (thresh ${autoSendThreshold.toFixed(2)})` },
                    ],
                  },
                  { type: "section", text: { type: "mrkdwn", text: `*Reason:*\n${evaluation.reason}` } },
                  { type: "section", text: { type: "mrkdwn", text: `<${url}|Open lead in dashboard>` } },
                ],
              }).catch(() => undefined);
            }
          } else if (!emailCampaign && lead.autoReplyEnabled && draftId) {
            const decision = await decideShouldAutoReply({
              clientId: client.id,
              leadId: lead.id,
              channel: "email",
              latestInbound: cleanedBody,
              subject: subject ?? null,
              conversationHistory: transcript,
              categorization: sentimentTag,
              automatedReply: null,
              replyReceivedAt: sentAt,
            });

            if (decision.shouldReply) {
              const sendResult = await approveAndSendDraftSystem(draftId, { sentBy: "ai" });
              if (sendResult.success) autoReplySent = true;
            }
          }
        }
      }

      return NextResponse.json({
        success: true,
        eventType,
        leadId: lead.id,
        sentimentTag,
        status: leadStatus,
        draftId,
        autoReplySent,
      });
    }

    if (eventType === "email_sent") {
      const leadEmail = normalizeOptionalString(payload.contact_email);
      const sentEmailId = normalizeOptionalString(payload.email_id);
      if (!leadEmail || !sentEmailId) {
        return NextResponse.json({ error: "Missing contact_email or email_id" }, { status: 400 });
      }

      const sentAt = parseEpochToDate(payload.timestamp);
      const inboxxiaScheduledEmailId = `instantly:${sentEmailId}`;

      const existingMessage = await prisma.message.findUnique({
        where: { inboxxiaScheduledEmailId },
        select: { id: true },
      });
      if (existingMessage) return NextResponse.json({ success: true, deduped: true, eventType });

      const campaignId = normalizeOptionalString(payload.campaign_id);
      const campaignName = normalizeOptionalString(payload.campaign_name);
      const emailCampaign = campaignId
        ? await prisma.emailCampaign.upsert({
            where: { clientId_bisonCampaignId: { clientId: client.id, bisonCampaignId: campaignId } },
            create: { clientId: client.id, bisonCampaignId: campaignId, name: campaignName || `Campaign ${campaignId}` },
            update: { name: campaignName || `Campaign ${campaignId}` },
          })
        : null;

      const { firstName, lastName } = splitName(normalizeOptionalString(payload.contact_name));
      const leadResult = await findOrCreateLead(
        client.id,
        { email: leadEmail, firstName, lastName },
        undefined,
        emailCampaign ? { emailCampaignId: emailCampaign.id } : undefined
      );

      const subject = normalizeOptionalString(payload.email_subject) ?? null;
      const rawText = normalizeOptionalString(payload.email_text);
      const rawHtml = normalizeOptionalString(payload.email_html);
      const body = (rawText || rawHtml || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

      await prisma.message.create({
        data: {
          inboxxiaScheduledEmailId,
          channel: "email",
          source: "inboxxia_campaign",
          body,
          rawText,
          rawHtml,
          subject,
          cc: [],
          bcc: [],
          isRead: true,
          direction: "outbound",
          leadId: leadResult.lead.id,
          sentAt,
        },
      });

      await bumpLeadMessageRollup({ leadId: leadResult.lead.id, direction: "outbound", sentAt });
      await autoStartNoResponseSequenceOnOutbound({ leadId: leadResult.lead.id, outboundAt: sentAt });

      return NextResponse.json({ success: true, eventType, leadId: leadResult.lead.id });
    }

    if (eventType === "unsubscribed") {
      const leadEmail = normalizeOptionalString(payload.contact_email);
      if (!leadEmail) return NextResponse.json({ error: "Missing contact_email" }, { status: 400 });

      const campaignId = normalizeOptionalString(payload.campaign_id);
      const campaignName = normalizeOptionalString(payload.campaign_name);
      const emailCampaign = campaignId
        ? await prisma.emailCampaign.upsert({
            where: { clientId_bisonCampaignId: { clientId: client.id, bisonCampaignId: campaignId } },
            create: { clientId: client.id, bisonCampaignId: campaignId, name: campaignName || `Campaign ${campaignId}` },
            update: { name: campaignName || `Campaign ${campaignId}` },
          })
        : null;

      const { firstName, lastName } = splitName(normalizeOptionalString(payload.contact_name));
      const leadResult = await findOrCreateLead(
        client.id,
        { email: leadEmail, firstName, lastName },
        undefined,
        emailCampaign ? { emailCampaignId: emailCampaign.id } : undefined
      );

      await prisma.lead.update({
        where: { id: leadResult.lead.id },
        data: { status: "blacklisted", sentimentTag: "Blacklist" },
      });
      await prisma.lead.updateMany({
        where: { id: leadResult.lead.id, enrichmentStatus: "pending" },
        data: { enrichmentStatus: "not_needed" },
      });
      await prisma.aIDraft.updateMany({
        where: { leadId: leadResult.lead.id, status: "pending" },
        data: { status: "rejected" },
      });

      return NextResponse.json({ success: true, eventType, leadId: leadResult.lead.id, blacklisted: true });
    }

    return NextResponse.json({ success: true, ignored: true, eventType });
  } catch (error) {
    console.error("[Instantly Webhook] Error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "Instantly webhook endpoint is active",
    supportedEvents: ["reply_received", "email_sent", "unsubscribed"],
    timestamp: new Date().toISOString(),
  });
}
