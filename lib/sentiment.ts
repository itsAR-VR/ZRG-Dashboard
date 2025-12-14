import "@/lib/server-dns";
import OpenAI from "openai";

// Sentiment tags for classification
export const SENTIMENT_TAGS = [
  "Meeting Requested",
  "Call Requested",
  "Information Requested",
  "Not Interested",
  "Blacklist",
  "Follow Up",
  "Out of Office",
  "Interested",
  "Neutral",
  "Snoozed", // Temporarily hidden from follow-up list
] as const;

export type SentimentTag = (typeof SENTIMENT_TAGS)[number];

// Map sentiment tags to lead statuses
export const SENTIMENT_TO_STATUS: Record<SentimentTag, string> = {
  "Meeting Requested": "meeting-requested",
  "Call Requested": "qualified",
  "Information Requested": "qualified",
  "Not Interested": "not-interested",
  "Blacklist": "blacklisted",
  "Follow Up": "new",
  "Out of Office": "new",
  "Interested": "qualified",
  "Neutral": "new",
  "Snoozed": "new",
};

// Positive sentiments that trigger Clay enrichment
// These indicate the lead is engaged and worth enriching for phone/LinkedIn
export const POSITIVE_SENTIMENTS = [
  "Meeting Requested",
  "Call Requested",
  "Information Requested",
  "Interested",
] as const;

export type PositiveSentiment = (typeof POSITIVE_SENTIMENTS)[number];

/**
 * Check if a sentiment tag is positive (triggers enrichment)
 * Used to determine when to auto-trigger Clay enrichment
 */
export function isPositiveSentiment(tag: string | null): tag is PositiveSentiment {
  if (!tag) return false;
  return POSITIVE_SENTIMENTS.includes(tag as PositiveSentiment);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ============================================================================
// REGEX BOUNCE DETECTION
// ============================================================================

/**
 * Regex patterns for detecting email bounces and system messages
 * These should be classified as "Blacklist" without calling AI
 */
const BOUNCE_PATTERNS = [
  /mail delivery (failed|failure|subsystem)/i,
  /delivery status notification/i,
  /undeliverable/i,
  /address not found/i,
  /user unknown/i,
  /mailbox (full|unavailable|not found)/i,
  /quota exceeded/i,
  /does not exist/i,
  /rejected/i,
  /access denied/i,
  /blocked/i,
  /spam/i,
  /mailer-daemon/i,
  /postmaster/i,
  /550[\s-]/i,  // SMTP error codes
  /554[\s-]/i,
  /the email account.*does not exist/i,
];

/**
 * Check if any inbound message matches bounce patterns
 * Call this BEFORE classifySentiment to detect bounces without AI
 */
export function detectBounce(messages: { body: string; direction: string }[]): boolean {
  const inboundMessages = messages.filter(m => m.direction === "inbound");

  for (const msg of inboundMessages) {
    const body = msg.body.toLowerCase();
    for (const pattern of BOUNCE_PATTERNS) {
      if (pattern.test(body)) {
        return true;
      }
    }
  }

  return false;
}

// ============================================================================
// RETRY LOGIC
// ============================================================================

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Classify conversation sentiment using OpenAI with retry logic
 * 
 * IMPORTANT: This function should only be called AFTER pre-classification checks:
 * - If lead has never responded → return "Neutral" (don't call this function)
 * - If detectBounce() returns true → return "Blacklist" (don't call this function)
 * 
 * This function analyzes the conversation content when the lead HAS responded.
 * It always uses AI classification regardless of how long ago the lead responded.
 */
export async function classifySentiment(
  transcript: string,
  maxRetries: number = 3
): Promise<SentimentTag> {
  if (!transcript || !process.env.OPENAI_API_KEY) {
    return "Neutral";
  }

  const systemPrompt = `You are a sales conversation classifier. Analyze the conversation transcript and classify it into ONE category based on the LEAD's responses (not the Agent's messages).

CATEGORIES:
- "Meeting Requested" - Lead explicitly agrees to or confirms a meeting/call. Examples:
  * "tomorrow works well"
  * "yes, let's do it"
  * "I'm free on Tuesday"
  * "sounds good, when?"
  * "let's set up a call"
  * Any time/date confirmation
- "Call Requested" - Lead provides a phone number or explicitly asks to be called
- "Information Requested" - Lead asks questions or requests details about pricing, what's being offered, process, etc.
- "Not Interested" - Lead explicitly declines or says no
- "Blacklist" - Hostile/abusive messages, opt-out requests, or EMAIL BOUNCES
- "Follow Up" - Lead deferred action ("busy right now", "later", "let me think")
- "Out of Office" - Lead mentions being on vacation or temporarily unavailable
- "Interested" - Lead shows clear interest without specific action ("sounds good", "I'm interested", "tell me more")
- "Neutral" - Lead's response is genuinely ambiguous with no clear intent (RARE)

CRITICAL RULES:
1. SHORT CONFIRMATIONS like "tomorrow works well", "yes", "sounds good, when?", "let's do Tuesday" = "Meeting Requested"
2. Any time/date confirmation or agreement to meet = "Meeting Requested"
3. Phone number provided = "Call Requested"
4. Questions about the offer = "Information Requested"
5. Only use "Neutral" if truly ambiguous (very rare)

Respond with ONLY the category name, nothing else.`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Classify this conversation:\n\n${transcript}` }
        ],
        max_tokens: 50,
        temperature: 0,
      });

      const result = response.choices[0]?.message?.content?.trim() as SentimentTag;

      if (result && SENTIMENT_TAGS.includes(result)) {
        return result;
      }

      // Handle legacy "Positive" responses from AI by mapping to "Interested"
      if (result === "Positive") {
        return "Interested";
      }

      return "Neutral";
    } catch (error) {
      const isRetryable = error instanceof Error &&
        (error.message.includes("500") ||
          error.message.includes("503") ||
          error.message.includes("rate") ||
          error.message.includes("timeout"));

      if (isRetryable && attempt < maxRetries) {
        const backoffMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        console.log(`[Sentiment] Attempt ${attempt} failed, retrying in ${backoffMs / 1000}s...`);
        await sleep(backoffMs);
      } else {
        console.error("[Sentiment] Classification error after retries:", error);
        return "Neutral";
      }
    }
  }

  return "Neutral";
}
