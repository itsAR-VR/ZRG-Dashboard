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

// Clay callback payload structure
interface ClayEnrichmentCallback {
  leadId: string;
  enrichmentType: "linkedin" | "phone";
  status: "success" | "not_found" | "error";
  // LinkedIn enrichment fields
  linkedinUrl?: string;
  linkedinId?: string;
  // Phone enrichment fields
  phone?: string;
  // Error details
  error?: string;
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

    const payload: ClayEnrichmentCallback = JSON.parse(rawBody);

    console.log(`[Clay Webhook] Received ${payload.enrichmentType} enrichment result for lead ${payload.leadId}: ${payload.status}`);

    // Validate required fields
    if (!payload.leadId || !payload.enrichmentType) {
      return NextResponse.json(
        { error: "Missing required fields: leadId, enrichmentType" },
        { status: 400 }
      );
    }

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

    if (payload.status === "success") {
      if (payload.enrichmentType === "linkedin" && payload.linkedinUrl) {
        const normalizedUrl = normalizeLinkedInUrl(payload.linkedinUrl);
        if (normalizedUrl && !lead.linkedinUrl) {
          updateData.linkedinUrl = normalizedUrl;
          if (payload.linkedinId) {
            updateData.linkedinId = payload.linkedinId;
          }
        }
      } else if (payload.enrichmentType === "phone" && payload.phone) {
        const stored = toStoredPhone(payload.phone);
        if (stored && !lead.phone) {
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
    } else if (payload.status === "not_found") {
      // Only update status if no data was found (avoid overwriting successful enrichments)
      if (!lead.enrichmentStatus || lead.enrichmentStatus === "pending") {
        updateData.enrichmentStatus = "not_found";
      }

      console.log(`[Clay Webhook] No ${payload.enrichmentType} data found for lead ${payload.leadId}`);
    } else if (payload.status === "error") {
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
    if (payload.enrichmentType === "phone" && payload.status === "success") {
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
