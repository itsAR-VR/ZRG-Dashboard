/**
 * Clay webhook callback handler
 * Receives enrichment results from Clay tables and updates lead data
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyClayWebhookSignature } from "@/lib/clay-api";
import { normalizeLinkedInUrl } from "@/lib/linkedin-utils";
import { ensureGhlContactIdForLead, syncGhlContactPhoneForLead } from "@/lib/ghl-contacts";
import { resumeAwaitingEnrichmentFollowUpsForLead } from "@/lib/followup-engine";
import { toStoredPhone } from "@/lib/phone-utils";

type ClayEnrichmentType = "linkedin" | "phone";
type ClayEnrichmentStatus = "success" | "not_found" | "error";

type NormalizedClayEnrichmentCallback = {
  leadId: string;
  enrichmentType: ClayEnrichmentType;
  status: ClayEnrichmentStatus;
  // LinkedIn enrichment fields
  linkedinUrl?: string;
  linkedinId?: string;
  // Phone enrichment fields
  phone?: string;
  // Error details
  error?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStringField(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function getBooleanField(obj: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function normalizeEnrichmentType(value: unknown): ClayEnrichmentType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "linkedin") return "linkedin";
  if (normalized === "phone") return "phone";
  return null;
}

function normalizeStatus(value: unknown): ClayEnrichmentStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();

  if (normalized === "success" || normalized === "ok" || normalized === "succeeded") return "success";
  if (normalized === "not_found" || normalized === "notfound" || normalized === "missing") return "not_found";
  if (normalized === "error" || normalized === "failed" || normalized === "failure") return "error";

  return null;
}

function normalizeClayCallbackPayload(raw: unknown): { payload?: NormalizedClayEnrichmentCallback; error?: string } {
  if (!isRecord(raw)) return { error: "Invalid JSON body: expected an object" };

  const leadId = getStringField(raw, ["leadId", "leadID", "lead_id"]);
  if (!leadId) return { error: "Missing required field: leadId" };

  const enrichmentType = normalizeEnrichmentType(getStringField(raw, ["enrichmentType", "type", "enrichment_type"]));
  if (!enrichmentType) return { error: "Missing or invalid required field: enrichmentType" };

  const linkedinUrl = getStringField(raw, ["linkedinUrl", "linkedin_url", "profileUrl", "profile_url", "linkedinProfile", "linkedin_profile"]);
  const linkedinId = getStringField(raw, ["linkedinId", "linkedin_id"]);
  const phone = getStringField(raw, ["phone", "phoneNumber", "phone_number", "validatedPhone", "validated_phone"]);
  const error = getStringField(raw, ["error", "errorMessage", "error_message", "message"]);

  // Clay table configs sometimes send a boolean `success` instead of a `status` string.
  // We treat `status` as authoritative when present; otherwise infer from presence of result fields.
  const statusFromField = normalizeStatus(getStringField(raw, ["status", "result", "outcome"]));
  const successFlag = getBooleanField(raw, ["success", "ok"]);

  const hasResult = enrichmentType === "linkedin"
    ? Boolean(normalizeLinkedInUrl(linkedinUrl))
    : Boolean(toStoredPhone(phone));

  const status: ClayEnrichmentStatus =
    statusFromField ||
    (hasResult ? "success" : error ? "error" : successFlag === false ? "error" : "not_found");

  return {
    payload: {
      leadId,
      enrichmentType,
      status,
      linkedinUrl,
      linkedinId,
      phone,
      error,
    },
  };
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    // Verify webhook signature
    const signature = request.headers.get("x-clay-signature") ||
      request.headers.get("x-webhook-signature") || "";

    if (!verifyClayWebhookSignature(rawBody, signature)) {
      console.error("[Clay Webhook] Invalid signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    let rawJson: unknown;
    try {
      rawJson = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const normalized = normalizeClayCallbackPayload(rawJson);
    if (!normalized.payload) {
      return NextResponse.json({ error: normalized.error || "Invalid payload" }, { status: 400 });
    }

    const payload = normalized.payload;

    console.log(`[Clay Webhook] Received ${payload.enrichmentType} enrichment result for lead ${payload.leadId}: ${payload.status}`);

    // Find the lead
    const lead = await prisma.lead.findUnique({
      where: { id: payload.leadId },
    });

    if (!lead) {
      console.error(`[Clay Webhook] Lead not found: ${payload.leadId}`);
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // Prepare update data based on enrichment type and status
    const updateData: Record<string, unknown> = {};

    // If the payload claims "success" but does not include a usable result field,
    // treat it as "not_found" unless the lead already has the data.
    let effectiveStatus: ClayEnrichmentStatus = payload.status;
    if (payload.status === "success") {
      if (payload.enrichmentType === "linkedin") {
        const normalizedUrl = normalizeLinkedInUrl(payload.linkedinUrl);
        if (!normalizedUrl && !normalizeLinkedInUrl(lead.linkedinUrl)) {
          effectiveStatus = "not_found";
        }
      } else if (payload.enrichmentType === "phone") {
        const stored = toStoredPhone(payload.phone);
        if (!stored && !toStoredPhone(lead.phone)) {
          effectiveStatus = "not_found";
        }
      }
    }

    if (payload.status !== effectiveStatus) {
      console.warn(
        `[Clay Webhook] Payload status "${payload.status}" missing usable data; treating as "${effectiveStatus}" for lead ${payload.leadId} (${payload.enrichmentType})`
      );
    }

    if (effectiveStatus === "success") {
      if (payload.enrichmentType === "linkedin" && payload.linkedinUrl) {
        const normalizedUrl = normalizeLinkedInUrl(payload.linkedinUrl);
        const existingNormalized = normalizeLinkedInUrl(lead.linkedinUrl);

        if (normalizedUrl && !existingNormalized) {
          updateData.linkedinUrl = normalizedUrl;
        }
        if (payload.linkedinId && !lead.linkedinId) {
          updateData.linkedinId = payload.linkedinId;
        }
      } else if (payload.enrichmentType === "phone" && payload.phone) {
        const stored = toStoredPhone(payload.phone);
        if (stored && !toStoredPhone(lead.phone)) {
          updateData.phone = stored;
        }
      }

      // Update enrichment status.
      //
      // Important: Clay can send separate callbacks for linkedin + phone when both were requested.
      // If the lead is still missing a phone and we were previously "pending", keep it pending so:
      // - the follow-up engine doesn't assume enrichment is complete
      // - the enrichment cleanup cron can eventually mark it failed/not_found
      const keepPending =
        payload.enrichmentType === "linkedin" && lead.enrichmentStatus === "pending" && !lead.phone;

      updateData.enrichmentStatus = keepPending ? "pending" : "enriched";
      updateData.enrichmentSource = "clay";
      if (!keepPending) {
        updateData.enrichedAt = new Date();
      }

      console.log(`[Clay Webhook] Enriched lead ${payload.leadId} with ${payload.enrichmentType} data`);
    } else if (effectiveStatus === "not_found") {
      // Only update status if no data was found (avoid overwriting successful enrichments)
      if (!lead.enrichmentStatus || lead.enrichmentStatus === "pending") {
        updateData.enrichmentStatus = "not_found";
      }

      console.log(`[Clay Webhook] No ${payload.enrichmentType} data found for lead ${payload.leadId}`);
    } else if (effectiveStatus === "error") {
      console.error(`[Clay Webhook] Enrichment error for lead ${payload.leadId}: ${payload.error}`);
      // Leave as pending for retry
    }

    // Apply updates if any
    if (Object.keys(updateData).length > 0) {
      await prisma.lead.update({
        where: { id: payload.leadId },
        data: updateData,
      });
    }

    // If we enriched a phone, ensure the lead is linked to a GHL contact and sync the phone over.
    if (payload.enrichmentType === "phone" && effectiveStatus === "success") {
      try {
        await ensureGhlContactIdForLead(payload.leadId, { allowCreateWithoutPhone: true });
        await syncGhlContactPhoneForLead(payload.leadId).catch(() => undefined);
      } catch (error) {
        console.warn("[Clay Webhook] Failed to sync enriched phone to GHL:", error);
      }

      // If any follow-up instances were paused waiting for enrichment, resume them now.
      await resumeAwaitingEnrichmentFollowUpsForLead(payload.leadId).catch(() => undefined);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Clay Webhook] Error processing callback:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "clay-webhook",
    timestamp: new Date().toISOString(),
  });
}
