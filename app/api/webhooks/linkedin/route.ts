/**
 * Unipile LinkedIn webhook handler
 * Receives inbound messages and connection updates from LinkedIn
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma, isPrismaUniqueConstraintError } from "@/lib/prisma";
import { verifyUnipileWebhookSecret } from "@/lib/unipile-api";
import {
  classifyLinkedInUrl,
  mergeLinkedInFields,
} from "@/lib/linkedin-utils";
import { bumpLeadMessageRollup } from "@/lib/lead-message-rollups";
import { enqueueBackgroundJob, buildJobDedupeKey } from "@/lib/background-jobs/enqueue";
import { BackgroundJobType } from "@prisma/client";

// Vercel Serverless Functions (Pro) require maxDuration in [1, 800].
export const maxDuration = 800;

// Unipile webhook event types
type UnipileEventType =
  | "message.received"
  | "message.sent"
  | "connection.accepted"
  | "connection.received"
  | "profile.viewed";

interface UnipileWebhookPayload {
  event: UnipileEventType;
  account_id: string;
  // Message event fields
  message?: {
    id: string;
    chat_id: string;
    text: string;
    sender_id: string;
    sender_name?: string;
    sender_linkedin_url?: string;
    timestamp: string;
    attachments?: Array<{
      type: string;
      url: string;
    }>;
  };
  // Connection event fields
  connection?: {
    id: string;
    linkedin_url: string;
    linkedin_member_id?: string;
    name?: string;
    first_name?: string;
    last_name?: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    // Verify webhook using custom header authentication
    if (!verifyUnipileWebhookSecret(request)) {
      console.error("[LinkedIn Webhook] Invalid or missing secret");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rawBody = await request.text();
    const payload: UnipileWebhookPayload = JSON.parse(rawBody);

    const accountId = (payload.account_id || "").trim();

    console.log(`[LinkedIn Webhook] Received event: ${payload.event} for account ${accountId}`);

    // Find the client (workspace) by Unipile account ID
    const client = await prisma.client.findFirst({
      where: { unipileAccountId: accountId },
    });

    if (!client) {
      // Treat as a non-fatal configuration issue (prevents webhook retry storms).
      console.warn(`[LinkedIn Webhook] Ignoring event for unknown Unipile account: ${accountId}`);
      return NextResponse.json({ success: true, ignored: true });
    }

    // Handle different event types
    switch (payload.event) {
      case "message.received":
        await handleInboundMessage(client.id, payload);
        break;

      case "connection.accepted":
        await handleConnectionAccepted(client.id, payload);
        break;

      case "connection.received":
        // Log connection requests but don't auto-accept
        console.log("[LinkedIn Webhook] Connection request received");
        break;

      default:
        console.log(`[LinkedIn Webhook] Unhandled event type: ${payload.event}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[LinkedIn Webhook] Error processing event:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * Handle inbound LinkedIn message
 * Creates message record and enqueues background job for AI processing
 */
async function handleInboundMessage(clientId: string, payload: UnipileWebhookPayload) {
  const message = payload.message;
  if (!message) {
    console.error("[LinkedIn Webhook] No message data in payload");
    return;
  }

  const incomingLinkedIn = classifyLinkedInUrl(message.sender_linkedin_url);
  const incomingProfileUrl = incomingLinkedIn.profileUrl;
  const incomingCompanyUrl = incomingLinkedIn.companyUrl;
  const incomingLeadId = message.sender_id || null;

  // Find or create lead by LinkedIn ID and profile URL only.
  // Company URLs are never person identifiers.
  const leadLookupOr = [
    ...(incomingLeadId ? [{ linkedinId: incomingLeadId }] : []),
    ...(incomingProfileUrl ? [{ linkedinUrl: incomingProfileUrl }] : []),
  ];

  let lead =
    leadLookupOr.length > 0
      ? await prisma.lead.findFirst({
          where: {
            clientId,
            OR: leadLookupOr,
          },
        })
      : null;

  if (!lead) {
    // Try to find by email if sender name contains "@"
    // Or create a new lead
    console.log(`[LinkedIn Webhook] Creating new lead for LinkedIn senderId: ${message.sender_id}`);

    // Parse sender name
    const nameParts = (message.sender_name || "").split(" ");
    const firstName = nameParts[0] || null;
    const lastName = nameParts.slice(1).join(" ") || null;

    lead = await prisma.lead.create({
      data: {
        clientId,
        linkedinId: incomingLeadId,
        ...(incomingProfileUrl ? { linkedinUrl: incomingProfileUrl } : {}),
        ...(incomingCompanyUrl ? { linkedinCompanyUrl: incomingCompanyUrl } : {}),
        firstName,
        lastName,
        status: "new",
        enrichmentStatus: "not_needed", // Created from LinkedIn, no enrichment needed
      },
    });

    console.log(`[LinkedIn Webhook] Created lead ${lead.id} from LinkedIn`);
  } else if (lead) {
    const mergedLinkedIn = mergeLinkedInFields({
      currentProfileUrl: lead.linkedinUrl,
      currentCompanyUrl: lead.linkedinCompanyUrl,
      incomingProfileUrl,
      incomingCompanyUrl,
    });
    const leadUpdates: Record<string, string | null> = {};
    if (!lead.linkedinId && incomingLeadId) {
      leadUpdates.linkedinId = incomingLeadId;
    }
    if (mergedLinkedIn.profileUrl !== (lead.linkedinUrl ?? null)) {
      leadUpdates.linkedinUrl = mergedLinkedIn.profileUrl;
    }
    if (mergedLinkedIn.companyUrl !== (lead.linkedinCompanyUrl ?? null)) {
      leadUpdates.linkedinCompanyUrl = mergedLinkedIn.companyUrl;
    }
    if (Object.keys(leadUpdates).length > 0) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: leadUpdates,
      });
    }
  }

  if (!lead) {
    console.error(`[LinkedIn Webhook] Could not find or create lead for sender: ${message.sender_id}`);
    return;
  }

  // Check for duplicate message using Unipile message ID
  const existingMessage = await prisma.message.findUnique({
    where: { unipileMessageId: message.id },
    select: { id: true },
  });

  if (existingMessage) {
    console.log(`[LinkedIn Webhook] Duplicate message detected (unipileMessageId=${message.id}), skipping`);
    return;
  }

  // Create message record - handle P2002 race condition via unipileMessageId unique constraint
  const sentAt = new Date(message.timestamp);
  let newMessage: { id: string };
  try {
    newMessage = await prisma.message.create({
      data: {
        unipileMessageId: message.id,
        leadId: lead.id,
        channel: "linkedin",
        source: "linkedin",
        body: message.text,
        direction: "inbound",
        sentAt,
        isRead: false,
      },
      select: { id: true },
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      console.log(`[LinkedIn Webhook] Dedupe race: unipileMessageId=${message.id} already exists`);
      return;
    }
    throw error;
  }

  await bumpLeadMessageRollup({ leadId: lead.id, direction: "inbound", sentAt });

  console.log(`[LinkedIn Webhook] Created message ${newMessage.id} for lead ${lead.id}`);

  // Enqueue background job for AI processing (sentiment, enrichment, drafts)
  const dedupeKey = buildJobDedupeKey(
    clientId,
    newMessage.id,
    BackgroundJobType.LINKEDIN_INBOUND_POST_PROCESS
  );

  await enqueueBackgroundJob({
    type: BackgroundJobType.LINKEDIN_INBOUND_POST_PROCESS,
    clientId,
    leadId: lead.id,
    messageId: newMessage.id,
    dedupeKey,
  });

  console.log(`[LinkedIn Webhook] Enqueued post-process job for message ${newMessage.id}`);
}

/**
 * Handle connection accepted event
 * Updates lead with LinkedIn member ID
 */
async function handleConnectionAccepted(clientId: string, payload: UnipileWebhookPayload) {
  const connection = payload.connection;
  if (!connection) {
    console.error("[LinkedIn Webhook] No connection data in payload");
    return;
  }

  const incomingLinkedIn = classifyLinkedInUrl(connection.linkedin_url);
  const incomingProfileUrl = incomingLinkedIn.profileUrl;
  const incomingCompanyUrl = incomingLinkedIn.companyUrl;
  const incomingMemberId = connection.linkedin_member_id || connection.id || null;

  const leadLookupOr = [
    ...(incomingMemberId ? [{ linkedinId: incomingMemberId }] : []),
    ...(incomingProfileUrl ? [{ linkedinUrl: incomingProfileUrl }] : []),
  ];

  const lead =
    leadLookupOr.length > 0
      ? await prisma.lead.findFirst({
          where: {
            clientId,
            OR: leadLookupOr,
          },
        })
      : null;

  if (lead) {
    // Update with member ID now that we're connected
    const mergedLinkedIn = mergeLinkedInFields({
      currentProfileUrl: lead.linkedinUrl,
      currentCompanyUrl: lead.linkedinCompanyUrl,
      incomingProfileUrl,
      incomingCompanyUrl,
    });
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        ...(incomingMemberId ? { linkedinId: incomingMemberId } : {}),
        ...(mergedLinkedIn.profileUrl !== (lead.linkedinUrl ?? null)
          ? { linkedinUrl: mergedLinkedIn.profileUrl }
          : {}),
        ...(mergedLinkedIn.companyUrl !== (lead.linkedinCompanyUrl ?? null)
          ? { linkedinCompanyUrl: mergedLinkedIn.companyUrl }
          : {}),
      },
    });

    console.log(`[LinkedIn Webhook] Updated lead ${lead.id} with LinkedIn connection data after accepted`);
  } else {
    console.log(
      `[LinkedIn Webhook] Connection accepted but no matching lead found for: ${
        incomingProfileUrl || incomingCompanyUrl || "n/a"
      }`
    );
  }
}

// Health check endpoint
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "linkedin-webhook",
    timestamp: new Date().toISOString(),
  });
}
