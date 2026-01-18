import { NextRequest, NextResponse } from "next/server";
import { prisma, isPrismaUniqueConstraintError } from "@/lib/prisma";
import { findOrCreateLead } from "@/lib/lead-matching";
import { autoStartNoResponseSequenceOnOutbound } from "@/lib/followup-automation";
import { bumpLeadMessageRollup } from "@/lib/lead-message-rollups";
import { EmailIntegrationProvider, BackgroundJobType } from "@prisma/client";
import { resolveEmailIntegrationProvider } from "@/lib/email-integration";
import { encodeSmartLeadReplyHandle } from "@/lib/email-reply-handle";
import { enqueueBackgroundJob, buildJobDedupeKey } from "@/lib/background-jobs/enqueue";

// Vercel Serverless Functions (Pro) require maxDuration in [1, 800].
export const maxDuration = 800;

type SmartLeadWebhookPayload = {
  event_type?: string;
  secret_key?: string | null;
  campaign_id?: string | number | null;
  campaign_name?: string | null;
  sl_lead_email?: string | null;
  sl_lead_name?: string | null;
  stats_id?: string | number | null;
  message_id?: string | number | null;
  from_email?: string | null;
  to_email?: string | null;
  subject?: string | null;
  preview_text?: string | null;
  cc_emails?: string[] | null;
  event_timestamp?: number | string | null;
  lead_correspondence?: {
    targetLeadEmail?: string | null;
    replyReceivedFrom?: string | null;
  } | null;
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

async function findClientById(clientId: string) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      emailProvider: true,
      smartLeadApiKey: true,
      smartLeadWebhookSecret: true,
      emailBisonApiKey: true,
      emailBisonWorkspaceId: true,
      instantlyApiKey: true,
      instantlyWebhookSecret: true,
    },
  });
  return client;
}

function isAuthorizedSmartLeadWebhook(params: { request: NextRequest; payload: SmartLeadWebhookPayload | null; expected: string | null }): boolean {
  if (!params.expected) return false;

  const authHeader = params.request.headers.get("authorization") || params.request.headers.get("Authorization") || "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme === "Bearer" && token && token === params.expected) return true;

  const headerSecret = params.request.headers.get("x-smartlead-secret");
  if (headerSecret && headerSecret === params.expected) return true;

  const payloadSecret = normalizeOptionalString(params.payload?.secret_key);
  if (payloadSecret && payloadSecret === params.expected) return true;

  return false;
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

    if (provider !== EmailIntegrationProvider.SMARTLEAD) {
      console.warn(`[SmartLead Webhook] Ignored: client ${clientId} provider is ${provider || "none"}`);
      return NextResponse.json({ success: true, ignored: true, reason: "provider_mismatch" });
    }

    const payload = (await request.json().catch(() => null)) as SmartLeadWebhookPayload | null;
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const expectedSecret = client.smartLeadWebhookSecret || null;
    if (!isAuthorizedSmartLeadWebhook({ request, payload, expected: expectedSecret })) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const eventType = normalizeOptionalString(payload.event_type) || "unknown";

    if (eventType === "EMAIL_REPLY") {
      const campaignIdRaw = payload.campaign_id;
      const campaignId = normalizeOptionalString(campaignIdRaw) ?? (typeof campaignIdRaw === "number" ? String(campaignIdRaw) : null);
      const statsIdRaw = payload.stats_id;
      const statsId = normalizeOptionalString(statsIdRaw) ?? (typeof statsIdRaw === "number" ? String(statsIdRaw) : null);
      const messageIdRaw = payload.message_id;
      const messageId = normalizeOptionalString(messageIdRaw) ?? (typeof messageIdRaw === "number" ? String(messageIdRaw) : null);

      if (!campaignId || !statsId) {
        return NextResponse.json({ error: "Missing campaign_id or stats_id" }, { status: 400 });
      }

      const leadEmail =
        normalizeOptionalString(payload.lead_correspondence?.targetLeadEmail) ||
        normalizeOptionalString(payload.sl_lead_email) ||
        normalizeOptionalString(payload.from_email);

      if (!leadEmail) {
        return NextResponse.json({ error: "Missing lead email" }, { status: 400 });
      }

      const replyFromEmail =
        normalizeOptionalString(payload.lead_correspondence?.replyReceivedFrom) ||
        normalizeOptionalString(payload.from_email) ||
        leadEmail;

      const replyHandle = encodeSmartLeadReplyHandle({
        campaignId,
        statsId,
        messageId,
        toEmail: replyFromEmail,
      });

      const existingMessage = await prisma.message.findUnique({
        where: { emailBisonReplyId: replyHandle },
        select: { id: true },
      });
      if (existingMessage) {
        return NextResponse.json({ success: true, deduped: true, eventType });
      }

      const campaignName = normalizeOptionalString(payload.campaign_name) || `Campaign ${campaignId}`;
      const emailCampaign = await prisma.emailCampaign.upsert({
        where: { clientId_bisonCampaignId: { clientId: client.id, bisonCampaignId: campaignId } },
        create: { clientId: client.id, bisonCampaignId: campaignId, name: campaignName },
        update: { name: campaignName },
      });

      const { firstName, lastName } = splitName(normalizeOptionalString(payload.sl_lead_name));
      const leadResult = await findOrCreateLead(
        client.id,
        { email: leadEmail, firstName, lastName },
        undefined,
        { emailCampaignId: emailCampaign.id }
      );

      const lead = leadResult.lead;

      const cc = Array.isArray(payload.cc_emails)
        ? payload.cc_emails.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        : [];
      const subject = normalizeOptionalString(payload.subject);
      const rawText = normalizeOptionalString(payload.preview_text);
      const cleanedBody = (rawText || "").trim();
      const sentAt = parseEpochToDate(payload.event_timestamp);

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
            rawHtml: null,
            subject,
            cc,
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
          console.log(`[SmartLead] Dedupe race: emailBisonReplyId=${replyHandle} already exists`);
          return NextResponse.json({ success: true, deduped: true, eventType });
        }
        throw error;
      }

      await bumpLeadMessageRollup({ leadId: lead.id, direction: "inbound", sentAt });

      console.log(`[SmartLead Webhook] Created message ${inboundMessage.id} for lead ${lead.id}`);

      // Enqueue background job for AI processing (sentiment, enrichment, drafts, auto-send)
      const dedupeKey = buildJobDedupeKey(
        client.id,
        inboundMessage.id,
        BackgroundJobType.SMARTLEAD_INBOUND_POST_PROCESS
      );

      await enqueueBackgroundJob({
        type: BackgroundJobType.SMARTLEAD_INBOUND_POST_PROCESS,
        clientId: client.id,
        leadId: lead.id,
        messageId: inboundMessage.id,
        dedupeKey,
      });

      console.log(`[SmartLead Webhook] Enqueued post-process job for message ${inboundMessage.id}`);

      return NextResponse.json({
        success: true,
        eventType,
        leadId: lead.id,
        messageId: inboundMessage.id,
        jobEnqueued: true,
      });
    }

    if (eventType === "EMAIL_SENT") {
      const campaignIdRaw = payload.campaign_id;
      const campaignId = normalizeOptionalString(campaignIdRaw) ?? (typeof campaignIdRaw === "number" ? String(campaignIdRaw) : null);
      if (!campaignId) return NextResponse.json({ error: "Missing campaign_id" }, { status: 400 });

      const leadEmail =
        normalizeOptionalString(payload.lead_correspondence?.targetLeadEmail) ||
        normalizeOptionalString(payload.sl_lead_email);
      if (!leadEmail) return NextResponse.json({ error: "Missing lead email" }, { status: 400 });

      const sentAt = parseEpochToDate(payload.event_timestamp);
      const dedupeIdRaw = payload.stats_id ?? payload.message_id ?? payload.event_timestamp ?? null;
      const dedupeId =
        normalizeOptionalString(dedupeIdRaw) ?? (typeof dedupeIdRaw === "number" ? String(dedupeIdRaw) : null) ?? sentAt.getTime().toString();
      const inboxxiaScheduledEmailId = `smartlead:${dedupeId}`;

      const existingMessage = await prisma.message.findUnique({
        where: { inboxxiaScheduledEmailId },
        select: { id: true },
      });
      if (existingMessage) return NextResponse.json({ success: true, deduped: true, eventType });

      const campaignName = normalizeOptionalString(payload.campaign_name) || `Campaign ${campaignId}`;
      const emailCampaign = await prisma.emailCampaign.upsert({
        where: { clientId_bisonCampaignId: { clientId: client.id, bisonCampaignId: campaignId } },
        create: { clientId: client.id, bisonCampaignId: campaignId, name: campaignName },
        update: { name: campaignName },
      });

      const { firstName, lastName } = splitName(normalizeOptionalString(payload.sl_lead_name));
      const leadResult = await findOrCreateLead(
        client.id,
        { email: leadEmail, firstName, lastName },
        undefined,
        { emailCampaignId: emailCampaign.id }
      );

      const subject = normalizeOptionalString(payload.subject);
      const rawText = normalizeOptionalString(payload.preview_text);
      const body = (rawText || "").trim();

      // Create outbound message - handle P2002 race condition
      try {
        await prisma.message.create({
          data: {
            inboxxiaScheduledEmailId,
            channel: "email",
            source: "inboxxia_campaign",
            body,
            rawText,
            rawHtml: null,
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
          console.log(`[SmartLead] Dedupe race: inboxxiaScheduledEmailId=${inboxxiaScheduledEmailId} already exists`);
          return NextResponse.json({ success: true, deduped: true, eventType });
        }
        throw error;
      }

      await bumpLeadMessageRollup({ leadId: leadResult.lead.id, direction: "outbound", sentAt });
      await autoStartNoResponseSequenceOnOutbound({ leadId: leadResult.lead.id, outboundAt: sentAt });

      return NextResponse.json({ success: true, eventType, leadId: leadResult.lead.id });
    }

    if (eventType === "LEAD_UNSUBSCRIBED") {
      const leadEmail =
        normalizeOptionalString(payload.lead_correspondence?.targetLeadEmail) ||
        normalizeOptionalString(payload.sl_lead_email);
      if (!leadEmail) return NextResponse.json({ error: "Missing lead email" }, { status: 400 });

      const campaignIdRaw = payload.campaign_id;
      const campaignId = normalizeOptionalString(campaignIdRaw) ?? (typeof campaignIdRaw === "number" ? String(campaignIdRaw) : null);
      const campaignName = campaignId ? normalizeOptionalString(payload.campaign_name) || `Campaign ${campaignId}` : null;
      const emailCampaign = campaignId
        ? await prisma.emailCampaign.upsert({
            where: { clientId_bisonCampaignId: { clientId: client.id, bisonCampaignId: campaignId } },
            create: { clientId: client.id, bisonCampaignId: campaignId, name: campaignName || `Campaign ${campaignId}` },
            update: { name: campaignName || `Campaign ${campaignId}` },
          })
        : null;

      const { firstName, lastName } = splitName(normalizeOptionalString(payload.sl_lead_name));
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
    console.error("[SmartLead Webhook] Error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "SmartLead webhook endpoint is active",
    supportedEvents: ["EMAIL_REPLY", "EMAIL_SENT", "LEAD_UNSUBSCRIBED"],
    timestamp: new Date().toISOString(),
  });
}
