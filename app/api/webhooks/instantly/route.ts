import { NextRequest, NextResponse } from "next/server";
import { prisma, isPrismaUniqueConstraintError } from "@/lib/prisma";
import { findOrCreateLead } from "@/lib/lead-matching";
import { autoStartNoResponseSequenceOnOutbound } from "@/lib/followup-automation";
import { bumpLeadMessageRollup } from "@/lib/lead-message-rollups";
import { EmailIntegrationProvider, BackgroundJobType } from "@prisma/client";
import { resolveEmailIntegrationProvider } from "@/lib/email-integration";
import { encodeInstantlyReplyHandle } from "@/lib/email-reply-handle";
import { enqueueBackgroundJob, buildJobDedupeKey } from "@/lib/background-jobs/enqueue";

// Vercel Serverless Functions (Pro) require maxDuration in [1, 800].
export const maxDuration = 800;

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

function isAuthorizedInstantlyWebhook(request: NextRequest, expected: string | null): boolean {
  if (!expected) return false;

  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme === "Bearer" && token && token === expected) return true;

  const headerSecret = request.headers.get("x-instantly-secret");
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

      // Create inbound message - handle P2002 race condition
      let inboundMessage: { id: string };
      try {
        inboundMessage = await prisma.message.create({
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
          select: { id: true },
        });
      } catch (error) {
        if (isPrismaUniqueConstraintError(error)) {
          console.log(`[Instantly] Dedupe race: emailBisonReplyId=${replyHandle} already exists`);
          return NextResponse.json({ success: true, deduped: true, eventType });
        }
        throw error;
      }

      await bumpLeadMessageRollup({ leadId: lead.id, direction: "inbound", sentAt });

      console.log(`[Instantly Webhook] Created message ${inboundMessage.id} for lead ${lead.id}`);

      // Enqueue background job for AI processing (sentiment, enrichment, drafts, auto-send)
      const dedupeKey = buildJobDedupeKey(
        client.id,
        inboundMessage.id,
        BackgroundJobType.INSTANTLY_INBOUND_POST_PROCESS
      );

      await enqueueBackgroundJob({
        type: BackgroundJobType.INSTANTLY_INBOUND_POST_PROCESS,
        clientId: client.id,
        leadId: lead.id,
        messageId: inboundMessage.id,
        dedupeKey,
      });

      console.log(`[Instantly Webhook] Enqueued post-process job for message ${inboundMessage.id}`);

      return NextResponse.json({
        success: true,
        eventType,
        leadId: lead.id,
        messageId: inboundMessage.id,
        jobEnqueued: true,
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

      // Create outbound message - handle P2002 race condition
      try {
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
      } catch (error) {
        if (isPrismaUniqueConstraintError(error)) {
          console.log(`[Instantly] Dedupe race: inboxxiaScheduledEmailId=${inboxxiaScheduledEmailId} already exists`);
          return NextResponse.json({ success: true, deduped: true, eventType });
        }
        throw error;
      }

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
