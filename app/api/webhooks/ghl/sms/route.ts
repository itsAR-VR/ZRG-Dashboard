import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";
import { generateResponseDraft, shouldGenerateDraft } from "@/lib/ai-drafts";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Sentiment tags for classification
const SENTIMENT_TAGS = [
  "Meeting Requested",
  "Call Requested",
  "Information Requested",
  "Not Interested",
  "Blacklist",
  "Follow Up",
  "Out of Office",
  "Positive",
  "Neutral",
] as const;

type SentimentTag = (typeof SENTIMENT_TAGS)[number];

// Map sentiment tags to lead statuses
const SENTIMENT_TO_STATUS: Record<SentimentTag, string> = {
  "Meeting Requested": "meeting-booked",
  "Call Requested": "qualified",
  "Information Requested": "qualified",
  "Not Interested": "not-interested",
  "Blacklist": "blacklisted",
  "Follow Up": "new",
  "Out of Office": "new",
  "Positive": "qualified",
  "Neutral": "new",
};

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
    const transcript = sortedMessages
      .map((m) => {
        const role = m.direction === "inbound" ? "Lead" : "Agent";
        return `${role}: ${m.body}`;
      })
      .join("\n");

    return { messages: sortedMessages, transcript };
  } catch (error) {
    console.error("[GHL API] Error fetching conversation history:", error);
    return { messages: [], transcript: "" };
  }
}

/**
 * Import historical messages into our database
 * Only imports messages that don't already exist
 */
async function importHistoricalMessages(
  leadId: string,
  messages: GHLExportedMessage[]
): Promise<number> {
  let importedCount = 0;

  for (const msg of messages) {
    try {
      // Check if message already exists (by checking for same body + timestamp combo)
      const existingMessage = await prisma.message.findFirst({
        where: {
          leadId,
          body: msg.body,
          createdAt: new Date(msg.dateAdded),
        },
      });

      if (!existingMessage) {
        await prisma.message.create({
          data: {
            body: msg.body,
            direction: msg.direction,
            leadId,
            createdAt: new Date(msg.dateAdded),
          },
        });
        importedCount++;
      }
    } catch (error) {
      // Ignore duplicate errors, log others
      if (!(error instanceof Error && error.message.includes("Unique"))) {
        console.error(`[Import] Error importing message: ${error}`);
      }
    }
  }

  return importedCount;
}

/**
 * Classify conversation sentiment using OpenAI
 */
async function classifySentiment(transcript: string): Promise<SentimentTag> {
  if (!transcript || !process.env.OPENAI_API_KEY) {
    return "Neutral";
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a sales conversation classifier. Analyze the conversation transcript and classify it into ONE of these categories:
          
- "Meeting Requested" - Lead wants to schedule a meeting or video call
- "Call Requested" - Lead provides a phone number or explicitly asks for a phone call
- "Information Requested" - Lead asks for more details/information about the product or service
- "Not Interested" - Lead explicitly declines or shows no interest
- "Blacklist" - Lead explicitly asks to stop contact, unsubscribe, or uses profanity/threats
- "Follow Up" - Conversation needs a follow-up but no clear next step
- "Out of Office" - Lead mentions being away/unavailable
- "Positive" - Generally positive response but no specific action requested
- "Neutral" - No clear sentiment or just acknowledgment

Respond with ONLY the category name, nothing else.`,
        },
        {
          role: "user",
          content: `Classify this SMS conversation:\n\n${transcript}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 50,
    });

    const result = completion.choices[0]?.message?.content?.trim() as SentimentTag;

    // Validate the result is a valid tag
    if (SENTIMENT_TAGS.includes(result)) {
      return result;
    }

    return "Neutral";
  } catch (error) {
    console.error("OpenAI classification error:", error);
    return "Neutral";
  }
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

    // Get the message body from current webhook
    const messageBody =
      payload.message?.body || payload.customData?.Message || "";

    console.log(`Processing message from ${firstName} ${lastName}: "${messageBody}"`);

    // Check if this is a new lead (first time seeing this contact)
    const existingLead = await prisma.lead.findUnique({
      where: { ghlContactId: contactId },
      include: { _count: { select: { messages: true } } },
    });

    const isNewLead = !existingLead;
    const hasNoMessages = !existingLead || existingLead._count.messages === 0;

    console.log(`Lead status: ${isNewLead ? "NEW" : "EXISTING"}, hasMessages: ${!hasNoMessages}`);

    // Fetch conversation history from GHL
    // Do this for new leads OR leads with no messages (to backfill history)
    let transcript = "";
    let historicalMessages: GHLExportedMessage[] = [];

    if (isNewLead || hasNoMessages) {
      console.log("[History Import] Fetching full conversation history from GHL...");
      const historyResult = await fetchGHLConversationHistory(
        locationId,
        contactId,
        client.ghlPrivateKey
      );
      historicalMessages = historyResult.messages;
      transcript = historyResult.transcript;
      console.log(`[History Import] Got ${historicalMessages.length} historical messages`);
    } else {
      // For existing leads with messages, just use the current message for classification
      transcript = `Lead: ${messageBody}`;
    }

    // Classify sentiment using AI
    const sentimentTag = await classifySentiment(transcript || messageBody);
    console.log(`AI Classification: ${sentimentTag}`);

    // Determine lead status based on sentiment
    const leadStatus = SENTIMENT_TO_STATUS[sentimentTag] || "new";
    console.log(`Lead status: ${leadStatus}`);

    // Upsert the lead with auto-updated status
    const lead = await prisma.lead.upsert({
      where: { ghlContactId: contactId },
      create: {
        ghlContactId: contactId,
        firstName,
        lastName,
        email,
        phone,
        status: leadStatus,
        sentimentTag,
        clientId: client.id,
      },
      update: {
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        email: email || undefined,
        phone: phone || undefined,
        sentimentTag,
        status: leadStatus, // Auto-update status based on sentiment
      },
    });

    console.log(`Upserted lead: ${lead.id}`);

    // Import historical messages if this is a new lead or has no messages
    let importedMessagesCount = 0;
    if ((isNewLead || hasNoMessages) && historicalMessages.length > 0) {
      console.log(`[History Import] Importing ${historicalMessages.length} messages...`);
      importedMessagesCount = await importHistoricalMessages(lead.id, historicalMessages);
      console.log(`[History Import] Imported ${importedMessagesCount} new messages`);
    } else if (messageBody) {
      // For existing leads, just save the current message
      const message = await prisma.message.create({
        data: {
          body: messageBody,
          direction: "inbound",
          leadId: lead.id,
        },
      });
      console.log(`Created message: ${message.id}`);
    }

    // Generate AI draft if appropriate for this sentiment
    let draftId: string | undefined;
    if (shouldGenerateDraft(sentimentTag)) {
      try {
        const draftResult = await generateResponseDraft(
          lead.id,
          transcript || `Lead: ${messageBody}`,
          sentimentTag
        );
        if (draftResult.success) {
          draftId = draftResult.draftId;
          console.log(`Generated AI draft: ${draftId}`);
        } else {
          console.error("Failed to generate AI draft:", draftResult.error);
        }
      } catch (error) {
        console.error("Error generating AI draft:", error);
      }
    } else {
      console.log(`Skipping AI draft for sentiment: ${sentimentTag}`);
    }

    console.log("=== Webhook Processing Complete ===");
    console.log(`Lead ID: ${lead.id}`);
    console.log(`Sentiment: ${sentimentTag}`);
    console.log(`Status: ${leadStatus}`);
    console.log(`Imported Messages: ${importedMessagesCount}`);
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
