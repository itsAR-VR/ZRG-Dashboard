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
  "Meeting Requested": "meeting-booked",
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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Classify conversation sentiment using OpenAI
 * 
 * IMPORTANT: This function should only be called AFTER pre-classification checks:
 * - If lead has never responded → return "Neutral" (don't call this function)
 * 
 * This function analyzes the conversation content when the lead HAS responded.
 * It always uses AI classification regardless of how long ago the lead responded.
 */
export async function classifySentiment(transcript: string): Promise<SentimentTag> {
  if (!transcript || !process.env.OPENAI_API_KEY) {
    return "Neutral";
  }

  try {
    // GPT-5-mini with low reasoning effort for sentiment classification using Responses API
    const response = await openai.responses.create({
      model: "gpt-5-mini",
      instructions: `<task>
You are a sales conversation classifier. Analyze the conversation transcript and classify it into ONE category based on the LEAD's responses (not the Agent's messages).
</task>

<categories>
- "Meeting Requested" - Lead explicitly asks for or confirms a meeting/video call time
- "Call Requested" - Lead provides a phone number or explicitly asks to be called
- "Information Requested" - Lead asks questions or requests details about:
  * General info: "tell me more", "what do you have?", "let's talk", "let's connect"
  * Pricing/value: "how much?", "what does it cost?", "what's it worth?", "what's X go for?"
  * Business inquiries: "what are you offering?", "what's the deal?", "what do you have in mind?"
  * Process/timeline: "how does it work?", "what's the process?", "how long does it take?"
- "Not Interested" - Lead explicitly declines or says no to further contact
- "Blacklist" - Lead should be blacklisted if ANY of these apply:
  * Hostile/abusive: profanity, threats, legal action threats
  * Opt-out requests: "unsubscribe", "stop contacting", "remove me from list"
  * EMAIL BOUNCE: "delivery failed", "undeliverable", "mailbox full", "user unknown", "address not found", "does not exist", "quota exceeded"
  * FIREWALL/SPAM BLOCK: "message blocked", "rejected", "spam", "rejected by policy", "blocked by recipient"
  * System messages from mailer-daemon, postmaster, or delivery subsystem
- "Follow Up" - Lead responded but deferred action ("I'm busy right now", "contact me later", "not right now", "let me think about it", "I'll get back to you") OR gave a simple acknowledgment without commitment ("ok", "thanks", "got it")
- "Out of Office" - Lead mentions being on vacation, traveling, or temporarily unavailable
- "Interested" - Lead shows clear interest or openness ("sure", "sounds good", "I'm interested", "yes", "okay let's do it", "listening to offers", "open to suggestions")
- "Neutral" - Lead's response is genuinely ambiguous with no clear intent (this should be RARE)
</categories>

<classification_rules>
CRITICAL RULES:
1. BLACKLIST DETECTION (highest priority): Any message indicating email bounce, delivery failure, spam block, or firewall rejection → "Blacklist". Look for: "delivery failed", "undeliverable", "mailbox full", "user unknown", "blocked", "rejected", "spam", "quota exceeded", "does not exist", "address not found"
2. ANY question from the lead = engagement signal. Questions about pricing, value, cost, process, timeline, or what you're offering → "Information Requested"
3. Curious questions like "what's X go for?", "what do you have in mind?", "how much for X?" → "Information Requested"
4. "Follow Up" is ONLY for leads who responded with deferrals ("busy", "later", "not now") or simple acknowledgments ("ok", "thanks")
5. Affirmative responses like "sure", "sounds good", "yes", "I'm interested" → "Interested"
6. Only use "Neutral" when the response is truly ambiguous with zero intent signals (this is rare - most responses have some intent)
7. Only use "Not Interested" for clear rejections ("no", "not interested", "don't contact me")
8. When in doubt between "Information Requested" and "Neutral", prefer "Information Requested" - questions show engagement
</classification_rules>

<output_format>
Respond with ONLY the category name, nothing else.
</output_format>`,
      input: `<conversation>
${transcript}
</conversation>`,
      reasoning: { effort: "low" },
      max_output_tokens: 50,
    });

    const result = response.output_text?.trim() as SentimentTag;

    if (result && SENTIMENT_TAGS.includes(result)) {
      return result;
    }

    // Handle legacy "Positive" responses from AI by mapping to "Interested"
    if (result === "Positive") {
      return "Interested";
    }

    return "Neutral";
  } catch (error) {
    console.error("OpenAI classification error:", error);
    return "Neutral";
  }
}
