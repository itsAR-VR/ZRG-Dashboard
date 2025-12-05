import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Sentiment tags for classification
const SENTIMENT_TAGS = [
  "Meeting Requested",
  "Not Interested",
  "Information Requested",
  "Blacklist",
  "Follow Up",
  "Out of Office",
  "Positive",
  "Neutral",
] as const;

type SentimentTag = (typeof SENTIMENT_TAGS)[number];

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

interface GHLMessage {
  id: string;
  body: string;
  direction: string;
  dateAdded: string;
  messageType: string;
}

/**
 * Fetch conversation history from GHL API
 */
async function fetchGHLConversation(
  contactId: string,
  privateKey: string
): Promise<string> {
  try {
    // GHL API endpoint for getting conversations
    const url = `https://services.leadconnectorhq.com/conversations/search?contactId=${contactId}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${privateKey}`,
        Version: "2021-04-15",
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error("GHL API error:", response.status, await response.text());
      return "";
    }

    const data = await response.json();
    const conversations = data.conversations || [];

    if (conversations.length === 0) {
      return "";
    }

    // Get the first conversation and fetch messages
    const conversationId = conversations[0].id;
    const messagesUrl = `https://services.leadconnectorhq.com/conversations/${conversationId}/messages`;

    const messagesResponse = await fetch(messagesUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${privateKey}`,
        Version: "2021-04-15",
        "Content-Type": "application/json",
      },
    });

    if (!messagesResponse.ok) {
      console.error("GHL Messages API error:", messagesResponse.status);
      return "";
    }

    const messagesData = await messagesResponse.json();
    const messages: GHLMessage[] = messagesData.messages || [];

    // Sort by date and format into transcript
    const sortedMessages = messages
      .filter((m) => m.messageType === "SMS" || m.messageType === "TYPE_SMS")
      .sort(
        (a, b) =>
          new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime()
      );

    const transcript = sortedMessages
      .map((m) => {
        const role = m.direction === "inbound" ? "Lead" : "Agent";
        return `${role}: ${m.body}`;
      })
      .join("\n");

    return transcript;
  } catch (error) {
    console.error("Error fetching GHL conversation:", error);
    return "";
  }
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
          
- "Meeting Requested" - Lead wants to schedule a call/meeting
- "Not Interested" - Lead explicitly declines or shows no interest
- "Information Requested" - Lead asks for more details/information
- "Blacklist" - Lead explicitly asks to stop contact or uses profanity/threats
- "Follow Up" - Conversation needs a follow-up but no clear next step
- "Out of Office" - Lead mentions being away/unavailable
- "Positive" - Generally positive response but no specific action
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

    // Get the message body
    const messageBody =
      payload.message?.body || payload.customData?.Message || "";

    console.log(`Processing message from ${firstName} ${lastName}: "${messageBody}"`);

    // Fetch conversation history from GHL for better context
    let transcript = "";
    try {
      transcript = await fetchGHLConversation(contactId, client.ghlPrivateKey);
      console.log(`Fetched conversation transcript (${transcript.length} chars)`);
    } catch (error) {
      console.error("Failed to fetch conversation history:", error);
    }

    // Classify sentiment using AI
    // Use transcript if available, otherwise just the current message
    const sentimentTag = await classifySentiment(transcript || messageBody);
    console.log(`AI Classification: ${sentimentTag}`);

    // Upsert the lead
    const lead = await prisma.lead.upsert({
      where: { ghlContactId: contactId },
      create: {
        ghlContactId: contactId,
        firstName,
        lastName,
        email,
        phone,
        status: "new",
        sentimentTag,
        clientId: client.id,
      },
      update: {
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        email: email || undefined,
        phone: phone || undefined,
        sentimentTag,
      },
    });

    console.log(`Upserted lead: ${lead.id}`);

    // Save the message if there's content
    if (messageBody) {
      const message = await prisma.message.create({
        data: {
          body: messageBody,
          direction: "inbound",
          leadId: lead.id,
        },
      });
      console.log(`Created message: ${message.id}`);
    }

    console.log("=== Webhook Processing Complete ===");
    console.log(`Lead ID: ${lead.id}`);
    console.log(`Sentiment: ${sentimentTag}`);

    return NextResponse.json({
      success: true,
      leadId: lead.id,
      contactId,
      sentimentTag,
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
