/**
 * Unipile LinkedIn webhook handler
 * Receives inbound messages and connection updates from LinkedIn
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyUnipileWebhookSecret } from "@/lib/unipile-api";
import { normalizeLinkedInUrl } from "@/lib/linkedin-utils";
import { buildSentimentTranscriptFromMessages, classifySentiment, isPositiveSentiment } from "@/lib/sentiment";
import { generateResponseDraft, shouldGenerateDraft } from "@/lib/ai-drafts";
import { extractContactFromMessageContent } from "@/lib/signature-extractor";
import { triggerEnrichmentForLead } from "@/lib/clay-api";
import { autoStartMeetingRequestedSequenceIfEligible } from "@/lib/followup-automation";
import { toStoredPhone } from "@/lib/phone-utils";
import { bumpLeadMessageRollup } from "@/lib/lead-message-rollups";

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

    console.log(`[LinkedIn Webhook] Received event: ${payload.event} for account ${payload.account_id}`);

    // Find the client (workspace) by Unipile account ID
    const client = await prisma.client.findFirst({
      where: { unipileAccountId: payload.account_id },
    });

    if (!client) {
      console.error(`[LinkedIn Webhook] No client found for Unipile account: ${payload.account_id}`);
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
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
        console.log(`[LinkedIn Webhook] Connection request received from ${payload.connection?.name}`);
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
 * Creates message record and generates AI draft
 */
async function handleInboundMessage(clientId: string, payload: UnipileWebhookPayload) {
  const message = payload.message;
  if (!message) {
    console.error("[LinkedIn Webhook] No message data in payload");
    return;
  }

  const senderLinkedInUrl = normalizeLinkedInUrl(message.sender_linkedin_url);

  // Find or create lead by LinkedIn URL
  let lead = await prisma.lead.findFirst({
    where: {
      clientId,
      OR: [
        { linkedinId: message.sender_id },
        senderLinkedInUrl ? { linkedinUrl: senderLinkedInUrl } : {},
      ].filter(Boolean),
    },
  });

  if (!lead && senderLinkedInUrl) {
    // Try to find by email if sender name contains "@"
    // Or create a new lead
    console.log(`[LinkedIn Webhook] Creating new lead for LinkedIn user: ${message.sender_name || message.sender_id}`);

    // Parse sender name
    const nameParts = (message.sender_name || "").split(" ");
    const firstName = nameParts[0] || null;
    const lastName = nameParts.slice(1).join(" ") || null;

    lead = await prisma.lead.create({
      data: {
        clientId,
        linkedinId: message.sender_id,
        linkedinUrl: senderLinkedInUrl,
        firstName,
        lastName,
        status: "new",
        enrichmentStatus: "not_needed", // Created from LinkedIn, no enrichment needed
      },
    });

    console.log(`[LinkedIn Webhook] Created lead ${lead.id} from LinkedIn`);
  } else if (lead && !lead.linkedinId) {
    // Update lead with LinkedIn ID if not set
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        linkedinId: message.sender_id,
        linkedinUrl: senderLinkedInUrl || lead.linkedinUrl,
      },
    });
  }

  if (!lead) {
    console.error(`[LinkedIn Webhook] Could not find or create lead for sender: ${message.sender_id}`);
    return;
  }

  // Check for duplicate message
  const existingMessage = await prisma.message.findFirst({
    where: {
      leadId: lead.id,
      channel: "linkedin",
      // Use message ID or timestamp+body hash for dedup
      body: message.text,
      sentAt: {
        gte: new Date(new Date(message.timestamp).getTime() - 60000), // Within 1 minute
        lte: new Date(new Date(message.timestamp).getTime() + 60000),
      },
    },
  });

  if (existingMessage) {
    console.log(`[LinkedIn Webhook] Duplicate message detected, skipping`);
    return;
  }

  // Create message record
  const sentAt = new Date(message.timestamp);
  const newMessage = await prisma.message.create({
    data: {
      leadId: lead.id,
      channel: "linkedin",
      source: "linkedin",
      body: message.text,
      direction: "inbound",
      sentAt,
      isRead: false,
    },
  });

  await bumpLeadMessageRollup({ leadId: lead.id, direction: "inbound", sentAt });

  console.log(`[LinkedIn Webhook] Created message ${newMessage.id} for lead ${lead.id}`);

  // ENRICHMENT: Extract contact info from message content
  // Leads often share their phone number in LinkedIn messages
  const messageExtraction = extractContactFromMessageContent(message.text);
  if (messageExtraction.foundInMessage) {
    const currentLead = await prisma.lead.findUnique({ where: { id: lead.id } });
    const messageUpdates: Record<string, unknown> = {};

    // Phone is the main thing we'd find in LinkedIn messages
    // (LinkedIn URL would already be known)
    if (messageExtraction.phone && !currentLead?.phone) {
      messageUpdates.phone = toStoredPhone(messageExtraction.phone);
      console.log(`[LinkedIn Webhook] Found phone in message for lead ${lead.id}: ${messageExtraction.phone}`);
    }

    if (Object.keys(messageUpdates).length > 0) {
      messageUpdates.enrichmentSource = "message_content";
      messageUpdates.enrichedAt = new Date();
      await prisma.lead.update({
        where: { id: lead.id },
        data: messageUpdates,
      });
      console.log(`[LinkedIn Webhook] Updated lead ${lead.id} from message content`);
    }
  }

  // Get conversation history for sentiment analysis
  const recentMessages = await prisma.message.findMany({
    where: { leadId: lead.id },
    orderBy: { sentAt: "asc" },
    take: 10,
    select: {
      sentAt: true,
      channel: true,
      direction: true,
      body: true,
      subject: true,
    },
  });

  const transcript = buildSentimentTranscriptFromMessages(recentMessages);

  // Classify sentiment
  const sentimentTag = await classifySentiment(transcript, { clientId, leadId: lead.id });

  // Update lead sentiment
  await prisma.lead.update({
    where: { id: lead.id },
    data: { sentimentTag },
  });

  await autoStartMeetingRequestedSequenceIfEligible({
    leadId: lead.id,
    previousSentiment: lead.sentimentTag,
    newSentiment: sentimentTag,
  });

  // Trigger Clay enrichment for phone if:
  // 1. Sentiment is positive (Meeting Requested, Call Requested, Info Requested, Interested)
  // 2. Lead is missing phone number
  // Note: LinkedIn leads already have linkedinUrl, so we only enrich for phone
  if (isPositiveSentiment(sentimentTag)) {
    const currentLead = await prisma.lead.findUnique({ where: { id: lead.id } });
    
    if (currentLead && !currentLead.phone && currentLead.email) {
      // Only enrich if we have an email (required for Clay) and missing phone
      // Skip if already enriched, pending, or not_needed
      const shouldSkipEnrichment = 
        currentLead.enrichmentStatus === "enriched" ||
        currentLead.enrichmentStatus === "pending" ||
        currentLead.enrichmentStatus === "not_needed";
      
      if (!shouldSkipEnrichment) {
        // Mark as pending with timestamp for timeout tracking
        await prisma.lead.update({
          where: { id: lead.id },
          data: { 
            enrichmentStatus: "pending",
            enrichmentLastRetry: new Date(), // Initialize for follow-up engine timeout calculations
          },
        });

        // Build enrichment request
        const fullName = `${currentLead.firstName || ""} ${currentLead.lastName || ""}`.trim();
        const enrichmentRequest = {
          leadId: lead.id,
          emailAddress: currentLead.email,
          firstName: currentLead.firstName || undefined,
          lastName: currentLead.lastName || undefined,
          fullName: fullName || undefined,
          linkedInProfile: currentLead.linkedinUrl || undefined,
        };

        // Trigger Clay enrichment for phone only (we already have LinkedIn)
        await triggerEnrichmentForLead(enrichmentRequest, false, true);
        console.log(`[LinkedIn Webhook] Triggered Clay phone enrichment for lead ${lead.id} (positive sentiment: ${sentimentTag})`);
      } else {
        console.log(`[LinkedIn Webhook] Skipping phone enrichment for lead ${lead.id} - status: ${currentLead.enrichmentStatus}`);
      }
    } else if (currentLead && !currentLead.phone && !currentLead.email) {
      console.log(`[LinkedIn Webhook] Cannot enrich lead ${lead.id} for phone - no email address available`);
    }
  }

  // Generate AI draft if appropriate
  if (shouldGenerateDraft(sentimentTag)) {
    await generateResponseDraft(lead.id, transcript, sentimentTag, "linkedin");
    console.log(`[LinkedIn Webhook] Generated AI draft for lead ${lead.id}`);
  }
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

  const linkedinUrl = normalizeLinkedInUrl(connection.linkedin_url);

  // Find lead by LinkedIn URL
  const lead = await prisma.lead.findFirst({
    where: {
      clientId,
      linkedinUrl,
    },
  });

  if (lead) {
    // Update with member ID now that we're connected
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        linkedinId: connection.linkedin_member_id || connection.id,
      },
    });

    console.log(`[LinkedIn Webhook] Updated lead ${lead.id} with LinkedIn member ID after connection accepted`);
  } else {
    console.log(`[LinkedIn Webhook] Connection accepted but no matching lead found for: ${linkedinUrl}`);
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
