import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateResponseDraft, shouldGenerateDraft } from "@/lib/ai-drafts";
import { syncConversationHistory, approveAndSendDraft } from "@/actions/message-actions";
import { buildSentimentTranscriptFromMessages, classifySentiment, SENTIMENT_TO_STATUS } from "@/lib/sentiment";
import { findOrCreateLead, normalizePhone } from "@/lib/lead-matching";
import { normalizeSmsCampaignLabel } from "@/lib/sms-campaign";
import { autoStartMeetingRequestedSequenceIfEligible } from "@/lib/followup-automation";
import { pauseFollowUpsOnReply, processMessageForAutoBooking } from "@/lib/followup-engine";
import { decideShouldAutoReply } from "@/lib/auto-reply-gate";

/**
 * GHL Workflow Webhook Payload Structure
 * Based on actual GHL webhook data
 */
interface GHLWebhookPayload {
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
}

/**
 * GHL Message from export API
 * Based on the actual API response structure
 */
interface GHLExportedMessage {
  id: string;
  direction: "inbound" | "outbound";
  status: string;
  type: number;
  locationId: string;
  attachments: unknown[];
  body: string;
  contactId: string;
  contentType: string;
  conversationId: string;
  dateAdded: string;
  dateUpdated: string;
  altId?: string;
  messageType: string;
  userId?: string;
  source?: string;
}

interface GHLExportResponse {
  messages: GHLExportedMessage[];
  nextCursor: string | null;
  total: number;
  traceId: string;
}

/**
 * Fetch full conversation history from GHL using the export API
 * Endpoint: GET /conversations/messages/export
 * Docs: https://marketplace.gohighlevel.com/docs/ghl/conversations/export-messages-by-location
 */
async function fetchGHLConversationHistory(
  locationId: string,
  contactId: string,
  privateKey: string
): Promise<{ messages: GHLExportedMessage[]; transcript: string }> {
  try {
    const url = new URL("https://services.leadconnectorhq.com/conversations/messages/export");
    url.searchParams.set("locationId", locationId);
    url.searchParams.set("contactId", contactId);
    url.searchParams.set("channel", "SMS");

    console.log(`[GHL API] Fetching conversation history: ${url.toString()}`);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${privateKey}`,
        Version: "2021-04-15",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[GHL API] Error ${response.status}: ${errorText}`);
      return { messages: [], transcript: "" };
    }

    const data: GHLExportResponse = await response.json();
    const messages = data.messages || [];

    console.log(`[GHL API] Fetched ${messages.length} messages (total: ${data.total})`);

    // Sort messages by date (oldest first for transcript)
    const sortedMessages = [...messages].sort(
      (a, b) => new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime()
    );

    // Build transcript for AI classification
    const transcript = buildSentimentTranscriptFromMessages(
      sortedMessages.map((m) => ({
        sentAt: m.dateAdded,
        channel: "sms",
        direction: m.direction,
        body: m.body,
      }))
    );

    return { messages: sortedMessages, transcript };
  } catch (error) {
    console.error("[GHL API] Error fetching conversation history:", error);
    return { messages: [], transcript: "" };
  }
}

/**
 * Import historical messages into our database
 * Uses GHL Message ID (ghlId) as source of truth for deduplication
 * Stores the actual GHL timestamp in sentAt for accurate time display
 */
async function importHistoricalMessages(
  leadId: string,
  messages: GHLExportedMessage[]
): Promise<{ imported: number; healed: number }> {
  let importedCount = 0;
  let healedCount = 0;

  for (const msg of messages) {
    try {
      const msgTimestamp = new Date(msg.dateAdded); // Actual time from GHL
      const ghlId = msg.id;

      // Step 1: Check if message exists by ghlId (definitive match)
      // @ts-ignore ghlId exists on Message model
      const existingByGhlId = await prisma.message.findUnique({
        where: { ghlId },
      } as any);

      if (existingByGhlId) {
        // Already imported with correct ghlId - just fix timestamp if needed
        if ((existingByGhlId as any).sentAt.getTime() !== msgTimestamp.getTime()) {
          await prisma.message.update({
            where: { ghlId },
            data: { sentAt: msgTimestamp },
          } as any);
          healedCount++;
          console.log(`[Import] Fixed timestamp for ghlId ${ghlId}`);
        }
        continue;
      }

      // Step 2: Check for legacy message without ghlId
      const existingByContent = await prisma.message.findFirst({
        where: {
          leadId,
          body: msg.body,
          direction: msg.direction,
          ghlId: null,
        },
      } as any);

      if (existingByContent) {
        // Heal the legacy message
        await prisma.message.update({
          where: { id: existingByContent.id },
          data: {
            ghlId,
            sentAt: msgTimestamp,
          },
        } as any);
        healedCount++;
        console.log(`[Import] Healed: "${msg.body.substring(0, 30)}..." -> ghlId: ${ghlId}`);
        continue;
      }

      // Step 3: Create new message with ghlId
      await prisma.message.create({
        data: {
          ghlId,
          body: msg.body,
          direction: msg.direction,
          channel: "sms",
          leadId,
          sentAt: msgTimestamp,
        },
      } as any);
      importedCount++;
      console.log(`[Import] Saved: "${msg.body.substring(0, 30)}..." (${msg.direction}) @ ${msgTimestamp.toISOString()}`);
    } catch (error) {
      console.error(`[Import] Error importing message ${msg.id}: ${error}`);
    }
  }

  return { imported: importedCount, healed: healedCount };
}

/**
 * POST handler for GHL SMS webhooks
 * Handles the workflow webhook payload from GoHighLevel
 */
export async function POST(request: NextRequest) {
  try {
    const payload: GHLWebhookPayload = await request.json();

    console.log("=== GHL SMS Webhook Received ===");
    console.log("Payload:", JSON.stringify(payload, null, 2));

    // Extract location ID (for client lookup)
    const locationId = payload.location?.id;

    if (!locationId) {
      console.error("Missing location.id in payload");
      return NextResponse.json(
        { error: "Missing location.id" },
        { status: 400 }
      );
    }

    // Extract contact ID
    const contactId = payload.contact_id;

    if (!contactId) {
      console.error("Missing contact_id in payload");
      return NextResponse.json(
        { error: "Missing contact_id" },
        { status: 400 }
      );
    }

    // Look up the client by locationId
    const client = await prisma.client.findUnique({
      where: { ghlLocationId: locationId },
    });

    if (!client) {
      console.log(`No client found for locationId: ${locationId}`);
      return NextResponse.json(
        { error: `Client not registered for location: ${locationId}` },
        { status: 404 }
      );
    }

    console.log(`Found client: ${client.name} (${client.id})`);

    // Extract contact info from root level fields
    const firstName = payload.first_name || payload.customData?.["First Name"] || null;
    const lastName = payload.last_name || payload.customData?.["Last Name"] || null;
    const email = payload.email || payload.customData?.Email || null;
    const phone = payload.phone || payload.customData?.["Phone Number"] || null;
    const normalizedPhone = normalizePhone(phone);

    // Get the message body from current webhook
    const messageBody =
      payload.message?.body || payload.customData?.Message || "";

    // Try to extract message timestamp from webhook payload
    // GHL may include date/time in customData or date_created field
    let webhookMessageTime: Date | null = null;

    // Try customData Date+Time fields
    if (payload.customData?.Date && payload.customData?.Time) {
      try {
        // Format: "Dec 5th, 2024" + "7:33 PM"
        const dateStr = `${payload.customData.Date} ${payload.customData.Time}`;
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
          webhookMessageTime = parsed;
          console.log(`[Webhook] Parsed message time from customData: ${webhookMessageTime.toISOString()}`);
        }
      } catch (e) {
        console.log(`[Webhook] Could not parse customData date: ${e}`);
      }
    }

    // Fallback to date_created if available
    if (!webhookMessageTime && payload.date_created) {
      try {
        const parsed = new Date(payload.date_created);
        if (!isNaN(parsed.getTime())) {
          webhookMessageTime = parsed;
          console.log(`[Webhook] Using date_created: ${webhookMessageTime.toISOString()}`);
        }
      } catch (e) {
        console.log(`[Webhook] Could not parse date_created: ${e}`);
      }
    }

    // Final fallback to now
    if (!webhookMessageTime) {
      webhookMessageTime = new Date();
      console.log(`[Webhook] Using current time as fallback: ${webhookMessageTime.toISOString()}`);
    }

    console.log(`Processing message from ${firstName} ${lastName}: "${messageBody}"`);
    console.log(`Contact info - Email: ${email}, Phone: ${phone} (normalized: ${normalizedPhone})`);

    // Extract SMS sub-client campaign label (e.g. customData.Client)
    const smsCampaignLabel = normalizeSmsCampaignLabel(
      payload.customData?.Client ?? payload.customData?.client
    );
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
      });
      smsCampaignId = smsCampaign.id;
    }

    // Use findOrCreateLead for cross-channel deduplication
    // This will match by email OR phone to find existing leads from other channels
    const leadResult = await findOrCreateLead(
      client.id,
      { email, phone, firstName, lastName },
      { ghlContactId: contactId },
      { smsCampaignId }
    );

    const isNewLead = leadResult.isNew;
    console.log(`Lead ${leadResult.lead.id}: ${isNewLead ? "NEW" : "EXISTING"} (matched by ${leadResult.matchedBy})`);

    // Check if this lead has existing SMS messages (not just any channel)
    // This matters for cross-channel matching where the lead might already have email messages.
    const smsMessageCount = await prisma.message.count({
      where: { leadId: leadResult.lead.id, channel: "sms" },
    });
    const hasNoSmsMessages = smsMessageCount === 0;

    console.log(`Lead status: ${isNewLead ? "NEW" : "EXISTING"}, hasSmsMessages: ${!hasNoSmsMessages}`);

    // Fetch conversation history from GHL
    // Do this for new leads OR leads with no messages (to backfill history)
    let transcript = "";
    let historicalMessages: GHLExportedMessage[] = [];

    if (isNewLead || hasNoSmsMessages) {
      console.log("[History Import] Fetching full conversation history from GHL...");
      const historyResult = await fetchGHLConversationHistory(
        locationId,
        contactId,
        client.ghlPrivateKey
      );
      historicalMessages = historyResult.messages;
      console.log(`[History Import] Got ${historicalMessages.length} historical messages`);

      // Ensure the *current* inbound webhook message is included for classification.
      // GHL's export API can lag and omit the latest inbound message, which would otherwise
      // cause the model to classify based on outbound-only history.
      const lastHistorical = historicalMessages[historicalMessages.length - 1];
      const shouldAppendWebhook =
        !!messageBody?.trim() &&
        !(
          lastHistorical &&
          lastHistorical.direction === "inbound" &&
          lastHistorical.body.trim() === messageBody.trim()
        );

      const transcriptMessages = [
        ...historicalMessages.map((m) => ({
          sentAt: m.dateAdded,
          channel: "sms",
          direction: m.direction,
          body: m.body,
        })),
        ...(shouldAppendWebhook
          ? [
              {
                sentAt: webhookMessageTime!,
                channel: "sms",
                direction: "inbound" as const,
                body: messageBody,
              },
            ]
          : []),
      ];

      transcript = buildSentimentTranscriptFromMessages(transcriptMessages);
    } else {
      // For existing leads, include turn-by-turn context (with timestamps) so ultra-short replies
      // like "yes/ok/sure" can be classified correctly based on what the agent asked right before.
      const recentSmsMessages = await prisma.message.findMany({
        where: { leadId: leadResult.lead.id, channel: "sms" },
        orderBy: { sentAt: "desc" },
        take: 25,
        select: {
          sentAt: true,
          channel: true,
          direction: true,
          body: true,
        },
      });

      transcript = buildSentimentTranscriptFromMessages([
        ...recentSmsMessages.reverse(),
        {
          sentAt: webhookMessageTime!,
          channel: "sms",
          direction: "inbound",
          body: messageBody,
        },
      ]);
    }

    // Track if we're clearing a "Follow Up" or "Snoozed" tag (for logging)
    const previousSentiment = leadResult.lead.sentimentTag;
    const wasFollowUp = previousSentiment === "Follow Up" || previousSentiment === "Snoozed";

    // Classify sentiment using AI
    // Note: Any inbound reply will reclassify sentiment, clearing "Follow Up" or "Snoozed" tags
    const sentimentTag = await classifySentiment(transcript || messageBody);
    console.log(`AI Classification: ${sentimentTag}`);

    // Log when "Follow Up" or "Snoozed" tag is being cleared by a reply
    if (wasFollowUp) {
      console.log(`[FOLLOWUP_CLEARED] Lead ${leadResult.lead.id} replied via SMS - clearing "${previousSentiment}" tag, new sentiment: ${sentimentTag}`);
    }

    // Determine lead status based on sentiment
    const leadStatus = SENTIMENT_TO_STATUS[sentimentTag] || "new";
    console.log(`Lead status: ${leadStatus}`);

    // Update lead with sentiment classification
    const lead = await prisma.lead.update({
      where: { id: leadResult.lead.id },
      data: {
        sentimentTag,
        status: leadStatus,
      },
    });

    console.log(`Updated lead ${lead.id} with sentiment: ${sentimentTag}`);

    await autoStartMeetingRequestedSequenceIfEligible({
      leadId: lead.id,
      previousSentiment,
      newSentiment: sentimentTag,
    });

    // Any inbound message pauses active follow-up sequences (re-engage after 7 days of no inbound).
    pauseFollowUpsOnReply(lead.id).catch((err) =>
      console.error("[Webhook] Failed to pause follow-ups on reply:", err)
    );

    // Import historical messages if this is a new lead or has no messages
    let importedMessagesCount = 0;
    let healedMessagesCount = 0;
    const isFirstInbound = isNewLead || hasNoSmsMessages;

    if (isFirstInbound && historicalMessages.length > 0) {
      console.log(`[History Import] Importing ${historicalMessages.length} messages...`);
      const importResult = await importHistoricalMessages(lead.id, historicalMessages);
      importedMessagesCount = importResult.imported;
      healedMessagesCount = importResult.healed;
      console.log(`[History Import] Imported ${importedMessagesCount} new, healed ${healedMessagesCount}`);

      // IMPORTANT: Check if the current webhook message was in the history
      // GHL's export API might not include the very latest message due to indexing delay
      // We save without ghlId here - it will be "healed" on next sync
      if (messageBody) {
        // Check by ghlId first (from history), then by content
        const currentMsgInHistory = historicalMessages.find(
          (m) => m.body === messageBody && m.direction === "inbound"
        );

        if (currentMsgInHistory) {
          // Already imported with ghlId from history
          console.log(`[Webhook] Current message already in history with ghlId: ${currentMsgInHistory.id}`);
        } else {
          // Not in history - save without ghlId (will be healed on next sync)
          console.log(`[Webhook] Current message not in history, saving without ghlId...`);
          await prisma.message.create({
            data: {
              body: messageBody,
              direction: "inbound",
              channel: "sms",
              leadId: lead.id,
              sentAt: webhookMessageTime,
              // ghlId will be added on next sync
            },
          } as any);
          importedMessagesCount++;
          console.log(`[Webhook] Saved current inbound message @ ${webhookMessageTime.toISOString()}`);
        }
      }
    } else if (messageBody) {
      // For existing leads with messages, save the current message
      // Check by ghlId first (if we have it from a previous sync)
      // Webhook payload doesn't include ghlId, so we check by content
      const existingByContent = await prisma.message.findFirst({
        where: {
          leadId: lead.id,
          body: messageBody,
          direction: "inbound",
        },
      });

      if (!existingByContent) {
        const message = await prisma.message.create({
          data: {
            body: messageBody,
            direction: "inbound",
            channel: "sms",
            leadId: lead.id,
            sentAt: webhookMessageTime,
            // ghlId will be added on next sync
          },
        } as any);
        console.log(`Created message: ${message.id} @ ${webhookMessageTime.toISOString()}`);
      } else {
        console.log(`[Webhook] Message already exists (id: ${existingByContent.id})`);
      }
    }

    // Always trigger background sync to normalize conversation by date/time
    // This runs as a fire-and-forget background job to:
    // 1. Fetch full conversation from GHL with accurate timestamps
    // 2. Heal any messages saved without ghlId
    // 3. Re-order messages by actual GHL dateAdded timestamp
    // 4. Re-classify sentiment based on complete conversation
    syncConversationHistory(lead.id).catch((err) =>
      console.error("[Webhook] Background sync failed:", err)
    );

    // Auto-booking: only books when the lead clearly accepts one of the offered slots.
    // If ambiguous, it creates a follow-up task instead (no booking).
    const autoBook = await processMessageForAutoBooking(lead.id, messageBody);
    if (autoBook.booked) {
      console.log(`[Auto-Book] Booked appointment for lead ${lead.id}: ${autoBook.appointmentId}`);
    }

    // Generate AI draft if appropriate for this sentiment
    let draftId: string | undefined;
    if (!autoBook.booked && shouldGenerateDraft(sentimentTag)) {
      try {
        const draftResult = await generateResponseDraft(
          lead.id,
          transcript || `Lead: ${messageBody}`,
          sentimentTag,
          "sms"
        );
        if (draftResult.success) {
          draftId = draftResult.draftId;
          console.log(`Generated AI draft: ${draftId}`);

          // Auto-Reply Logic: Check if enabled for this lead
          // lead.autoReplyEnabled comes from the database (via upsert)
          if (lead.autoReplyEnabled && draftId) {
            const decision = await decideShouldAutoReply({
              channel: "sms",
              latestInbound: messageBody,
              subject: null,
              conversationHistory: transcript || `Lead: ${messageBody}`,
              categorization: sentimentTag,
              automatedReply: null,
              replyReceivedAt: webhookMessageTime,
            });

            if (!decision.shouldReply) {
              console.log(`[Auto-Reply] Skipped auto-send for lead ${lead.id}: ${decision.reason}`);
            } else {
              console.log(`[Auto-Reply] Auto-approving draft ${draftId} for lead ${lead.id}`);
              const sendResult = await approveAndSendDraft(draftId);
              if (sendResult.success) {
                console.log(`[Auto-Reply] Sent message: ${sendResult.messageId}`);
                // Draft status is now 'approved' in DB
              } else {
                console.error(`[Auto-Reply] Failed to send draft: ${sendResult.error}`);
              }
            }
          }
        } else {
          console.error("Failed to generate AI draft:", draftResult.error);
        }
      } catch (error) {
        console.error("Error generating AI draft:", error);
      }
    } else {
      console.log(`Skipping AI draft for sentiment: ${sentimentTag}`);
    }

    // TODO: Auto-FollowUp feature - if lead.autoFollowUpEnabled is true, schedule follow-up tasks

    console.log("=== Webhook Processing Complete ===");
    console.log(`Lead ID: ${lead.id}`);
    console.log(`Sentiment: ${sentimentTag}`);
    console.log(`Status: ${leadStatus}`);
    console.log(`Imported Messages: ${importedMessagesCount}, Healed: ${healedMessagesCount}`);
    console.log(`Draft ID: ${draftId || "none"}`);

    return NextResponse.json({
      success: true,
      leadId: lead.id,
      contactId,
      sentimentTag,
      status: leadStatus,
      importedMessages: importedMessagesCount,
      draftId,
      message: "Webhook processed successfully",
    });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
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
