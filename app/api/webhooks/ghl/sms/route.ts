import { NextRequest, NextResponse } from "next/server";
import { BackgroundJobType } from "@prisma/client";

import { prisma, isPrismaUniqueConstraintError } from "@/lib/prisma";
import { findOrCreateLead } from "@/lib/lead-matching";
import { normalizeSmsCampaignLabel } from "@/lib/sms-campaign";
import { extractLinkedInUrlsFromValues } from "@/lib/linkedin-utils";
import { bumpLeadMessageRollup } from "@/lib/lead-message-rollups";
import { enqueueBackgroundJob, buildJobDedupeKey } from "@/lib/background-jobs/enqueue";
import { computeGhlSmsDedupeKey } from "@/lib/webhook-dedupe";

// Vercel Serverless Functions (Pro) require maxDuration in [1, 800].
export const maxDuration = 800;

function normalizeLooseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function coerceToLabelString(value: unknown): string | null {
  if (typeof value === "string") {
    const s = value.trim();
    return s ? s : null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value && typeof value === "object") {
    const anyVal = value as any;
    const candidates = [anyVal.name, anyVal.label, anyVal.value, anyVal.text];
    for (const c of candidates) {
      if (typeof c === "string") {
        const s = c.trim();
        if (s) return s;
      }
    }
  }

  return null;
}

type GHLWebhookPayload = {
  // Contact fields (snake_case from GHL)
  contact_id: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
  phone?: string;
  tags?: string;
  country?: string;
  date_created?: string;
  full_address?: string;
  contact_type?: string;

  // Location info
  location?: {
    id: string;
    name?: string;
    address?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
    fullAddress?: string;
  };

  // Message info
  message?: {
    type?: number;
    body?: string;
  };

  // Workflow info
  workflow?: {
    id?: string;
    name?: string;
  };

  // Custom data passed through the webhook
  customData?: {
    ID?: string;
    "Phone Number"?: string;
    "First Name"?: string;
    "Last Name"?: string;
    Email?: string;
    Message?: string;
    Date?: string;
    Time?: string;
    [key: string]: string | undefined;
  };

  // Attribution
  contact?: {
    attributionSource?: Record<string, unknown>;
    lastAttributionSource?: Record<string, unknown>;
  };
  attributionSource?: Record<string, unknown>;
  triggerData?: Record<string, unknown>;
};

function extractSmsSubClientLabelFromWebhookPayload(payload: GHLWebhookPayload): string | null {
  const direct = coerceToLabelString(payload.customData?.Client ?? payload.customData?.client);
  if (direct) return direct;

  const normalizedKeysByPriority = [
    "client",
    "clientname",
    "subclient",
    "subclientname",
    "smsclient",
    "smsclientname",
    "smssubclient",
    "smssubclientname",
    "smscampaign",
    "smscampaignname",
    "campaign",
    "campaignname",
  ];
  const allowed = new Set(normalizedKeysByPriority);

  const maybeSources: Array<unknown> = [payload.customData, payload.triggerData];
  for (const source of maybeSources) {
    if (!source || typeof source !== "object") continue;

    for (const [rawKey, rawValue] of Object.entries(source as Record<string, unknown>)) {
      const key = normalizeLooseKey(rawKey);
      if (!allowed.has(key)) continue;
      const label = coerceToLabelString(rawValue);
      if (label) return label;
    }
  }

  return null;
}

function resolveWebhookMessageTime(payload: GHLWebhookPayload, receivedAt: Date): Date {
  // Try to extract message timestamp from webhook payload.
  //
  // IMPORTANT: GHL workflow webhooks sometimes provide Date/Time as workspace-local strings (no timezone).
  // Parsing those strings on the server (UTC) can create a consistent offset, which breaks ordering.
  //
  // Prefer receipt time, and only trust webhook-provided timestamps when they're very close to receipt time.
  type TimestampCandidate = { label: string; value: Date };
  const candidates: TimestampCandidate[] = [];

  if (payload.customData?.Date && payload.customData?.Time) {
    const dateStr = `${payload.customData.Date} ${payload.customData.Time}`;
    const parsed = new Date(dateStr);
    if (!Number.isNaN(parsed.getTime())) {
      candidates.push({ label: "customData", value: parsed });
    }
  }

  if (payload.date_created) {
    const parsed = new Date(payload.date_created);
    if (!Number.isNaN(parsed.getTime())) {
      candidates.push({ label: "date_created", value: parsed });
    }
  }

  const maxDriftMs = 20 * 60_000; // 20 minutes
  let best: { label: string; value: Date; driftMs: number } | null = null;

  for (const candidate of candidates) {
    const driftMs = Math.abs(candidate.value.getTime() - receivedAt.getTime());
    if (driftMs > maxDriftMs) continue;
    if (!best || driftMs < best.driftMs) {
      best = { ...candidate, driftMs };
    }
  }

  return best?.value ?? receivedAt;
}

/**
 * POST handler for GHL SMS webhooks
 *
 * Critical-path responsibilities:
 * - Validate + map tenancy (locationId → client)
 * - Find/create Lead (cross-channel dedupe)
 * - Insert inbound Message (idempotent via webhookDedupeKey)
 * - Enqueue background job for post-processing (sentiment, drafts, booking, etc.)
 *
 * Do NOT do conversation-history sync or AI calls inline.
 */
export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as GHLWebhookPayload;

    const locationId = payload.location?.id ?? null;
    const contactId = payload.contact_id ?? null;
    const rawBody = payload.message?.body || payload.customData?.Message || "";
    const messageBody = (rawBody || "").trim();

    console.log("[GHL SMS Webhook] Received", {
      locationId,
      contactId,
      workflowId: payload.workflow?.id ?? null,
      hasCustomData: !!payload.customData,
      bodyLen: messageBody.length,
    });

    if (!locationId) {
      return NextResponse.json({ error: "Missing location.id" }, { status: 400 });
    }

    if (!contactId) {
      return NextResponse.json({ error: "Missing contact_id" }, { status: 400 });
    }

    const client = await prisma.client.findUnique({
      where: { ghlLocationId: locationId },
      select: { id: true },
    });

    if (!client) {
      return NextResponse.json({ error: `Client not registered for location: ${locationId}` }, { status: 404 });
    }

    if (!messageBody) {
      return NextResponse.json({ success: true, ignored: true, reason: "empty_message" }, { status: 200 });
    }

    const receivedAt = new Date();
    const sentAt = resolveWebhookMessageTime(payload, receivedAt);

    // Extract contact info from root/custom fields (best-effort).
    const firstName = payload.first_name || payload.customData?.["First Name"] || null;
    const lastName = payload.last_name || payload.customData?.["Last Name"] || null;
    const email = payload.email || payload.customData?.Email || null;
    const phone = payload.phone || payload.customData?.["Phone Number"] || null;
    const classifiedLinkedIn = extractLinkedInUrlsFromValues([payload.customData, payload.triggerData]);

    // Resolve SMS campaign (sub-client label) if present.
    const extractedSubClientLabel = extractSmsSubClientLabelFromWebhookPayload(payload);
    const smsCampaignLabel = normalizeSmsCampaignLabel(extractedSubClientLabel);
    let smsCampaignId: string | null = null;

    if (smsCampaignLabel) {
      const smsCampaign = await prisma.smsCampaign.upsert({
        where: {
          clientId_nameNormalized: {
            clientId: client.id,
            nameNormalized: smsCampaignLabel.nameNormalized,
          },
        },
        create: {
          clientId: client.id,
          name: smsCampaignLabel.name,
          nameNormalized: smsCampaignLabel.nameNormalized,
        },
        update: {
          name: smsCampaignLabel.name,
        },
        select: { id: true },
      });

      smsCampaignId = smsCampaign.id;
    }

    // Find or create lead by cross-channel identifiers (ghlContactId first, then email/phone).
    const leadResult = await findOrCreateLead(
      client.id,
      { email, phone, firstName, lastName },
      {
        ghlContactId: contactId,
        linkedinUrl: classifiedLinkedIn.profileUrl,
        linkedinCompanyUrl: classifiedLinkedIn.companyUrl,
      },
      { smsCampaignId }
    );

    const lead = leadResult.lead;

    // Compute a stable webhookDedupeKey for idempotent message creation.
    // This is used when ghlId is not available in the webhook payload.
    const webhookDedupeKey = computeGhlSmsDedupeKey({
      clientId: client.id,
      contactId,
      workflowId: payload.workflow?.id ?? null,
      dateCreated: payload.date_created ?? null,
      customDate: payload.customData?.Date ?? null,
      customTime: payload.customData?.Time ?? null,
      messageBody,
    });

    let messageId: string | null = null;
    let createdNewMessage = false;

    try {
      const created = await prisma.message.create({
        data: {
          webhookDedupeKey,
          body: messageBody,
          direction: "inbound",
          channel: "sms",
          leadId: lead.id,
          sentAt,
        },
        select: { id: true },
      });

      messageId = created.id;
      createdNewMessage = true;
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        const existing = await prisma.message.findUnique({
          where: { webhookDedupeKey },
          select: { id: true },
        });
        messageId = existing?.id ?? null;
      } else {
        throw error;
      }
    }

    if (createdNewMessage && messageId) {
      await bumpLeadMessageRollup({ leadId: lead.id, direction: "inbound", sentAt });
    }

    let jobEnqueued = false;
    if (messageId) {
      const dedupeKey = buildJobDedupeKey(client.id, messageId, BackgroundJobType.SMS_INBOUND_POST_PROCESS);
      jobEnqueued = await enqueueBackgroundJob({
        type: BackgroundJobType.SMS_INBOUND_POST_PROCESS,
        clientId: client.id,
        leadId: lead.id,
        messageId,
        dedupeKey,
      });
    }

    return NextResponse.json(
      {
        success: true,
        leadId: lead.id,
        contactId,
        messageId,
        jobEnqueued,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[GHL SMS Webhook] Error processing webhook:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * GET handler for webhook health check
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "GHL SMS webhook endpoint is active",
    timestamp: new Date().toISOString(),
    endpoints: {
      webhook: "POST /api/webhooks/ghl/sms",
      healthCheck: "GET /api/webhooks/ghl/sms",
    },
  });
}
