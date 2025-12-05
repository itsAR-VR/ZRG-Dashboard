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

interface GHLWebhookPayload {
  type: string;
  locationId: string;
  contactId: string;
  body?: string;
  message?: string;
  direction?: string;
  contact?: {
    id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    name?: string;
  };
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
      .sort((a, b) => new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime());

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
 */
export async function POST(request: NextRequest) {
  try {
    const payload: GHLWebhookPayload = await request.json();

    console.log("Received GHL webhook:", JSON.stringify(payload, null, 2));

    // Extract required fields
    const { locationId, contactId, contact, body, message, direction } = payload;

    if (!locationId) {
      return NextResponse.json(
        { error: "Missing locationId" },
        { status: 400 }
      );
    }

    if (!contactId) {
      return NextResponse.json(
        { error: "Missing contactId" },
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
        { error: "Client not registered" },
        { status: 404 }
      );
    }

    // Extract contact info
    const firstName = contact?.firstName || contact?.name?.split(" ")[0] || null;
    const lastName = contact?.lastName || contact?.name?.split(" ").slice(1).join(" ") || null;
    const email = contact?.email || null;
    const phone = contact?.phone || null;

    // Get the message body
    const messageBody = body || message || "";
    const messageDirection = direction || "inbound";

    // Fetch conversation history from GHL
    const transcript = await fetchGHLConversation(contactId, client.ghlPrivateKey);

    // Classify sentiment using AI
    const sentimentTag = await classifySentiment(transcript || messageBody);

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

    // Save the message if there's content
    if (messageBody) {
      await prisma.message.create({
        data: {
          body: messageBody,
          direction: messageDirection,
          leadId: lead.id,
        },
      });
    }

    console.log(`Processed webhook for lead ${lead.id}, sentiment: ${sentimentTag}`);

    return NextResponse.json({
      success: true,
      leadId: lead.id,
      sentimentTag,
    });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET handler for webhook verification (if needed)
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "GHL SMS webhook endpoint is active",
  });
}

