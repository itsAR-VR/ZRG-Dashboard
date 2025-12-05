import OpenAI from "openai";
import { prisma } from "@/lib/prisma";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface DraftGenerationResult {
  success: boolean;
  draftId?: string;
  content?: string;
  error?: string;
}

/**
 * Generate an AI response draft based on conversation context and sentiment
 * 
 * @param leadId - The lead ID
 * @param conversationTranscript - The conversation history
 * @param sentimentTag - The classified sentiment
 */
export async function generateResponseDraft(
  leadId: string,
  conversationTranscript: string,
  sentimentTag: string
): Promise<DraftGenerationResult> {
  try {
    // Get user settings for AI personality
    const settings = await prisma.userSettings.findUnique({
      where: { userId: "default" },
    });

    const aiTone = settings?.aiTone || "friendly-professional";
    const aiName = settings?.aiPersonaName || "Alex";
    const aiGreeting = settings?.aiGreeting || "Hi {firstName},";

    // Get the lead's first name for personalization
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { firstName: true },
    });

    const firstName = lead?.firstName || "there";

    // Determine the appropriate response strategy based on sentiment
    const responseStrategy = getResponseStrategy(sentimentTag);

    // Generate the draft using OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are ${aiName}, a professional sales representative. Generate a brief SMS response (under 160 characters) based on the conversation context and sentiment.

Tone: ${aiTone}
Strategy: ${responseStrategy}

Guidelines:
- Keep responses concise and SMS-friendly (under 160 characters)
- Be professional but personable
- Don't use emojis unless the lead used them first
- For meeting requests, offer specific times or ask for their availability
- For objections, acknowledge and redirect professionally
- Never be pushy or aggressive

The greeting format is: ${aiGreeting.replace("{firstName}", firstName)}`,
        },
        {
          role: "user",
          content: `Conversation transcript:
${conversationTranscript}

Lead sentiment: ${sentimentTag}

Generate an appropriate SMS response:`,
        },
      ],
      temperature: 0.7,
      max_tokens: 100,
    });

    const draftContent = completion.choices[0]?.message?.content?.trim();

    if (!draftContent) {
      return { success: false, error: "Failed to generate draft content" };
    }

    // Save the draft to the database
    const draft = await prisma.aIDraft.create({
      data: {
        leadId,
        content: draftContent,
        status: "pending",
      },
    });

    return {
      success: true,
      draftId: draft.id,
      content: draftContent,
    };
  } catch (error) {
    console.error("Failed to generate AI draft:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get the response strategy based on sentiment tag
 */
function getResponseStrategy(sentimentTag: string): string {
  const strategies: Record<string, string> = {
    "Meeting Requested": "Confirm interest and propose specific meeting times. Be enthusiastic but professional.",
    "Call Requested": "Acknowledge their request for a call. Confirm the best number to reach them and propose specific call times.",
    "Not Interested": "Acknowledge their decision respectfully. Ask if they'd like to be contacted in the future or if there's anything specific they're looking for.",
    "Information Requested": "Provide the requested information clearly and concisely. Offer to schedule a call for more details.",
    "Follow Up": "Check in on their interest level. Reference any previous context and offer value.",
    "Out of Office": "Acknowledge and ask when would be a good time to reconnect. Be understanding.",
    "Positive": "Build on the positive momentum. Move towards scheduling a conversation or next steps.",
    "Neutral": "Engage with a question or valuable insight to spark interest.",
    "Blacklist": "DO NOT GENERATE A RESPONSE - This contact has opted out.",
  };

  return strategies[sentimentTag] || "Respond professionally and try to move the conversation forward.";
}

/**
 * Check if we should generate a draft for this sentiment
 * Some sentiments (like Blacklist) should not get drafts
 */
export function shouldGenerateDraft(sentimentTag: string): boolean {
  const noResponseSentiments = ["Blacklist"];
  return !noResponseSentiments.includes(sentimentTag);
}

