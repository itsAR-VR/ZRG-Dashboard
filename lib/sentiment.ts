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
 * - If agent sent last message AND lead hasn't responded in 7+ days → return "Neutral"
 * 
 * This function analyzes the conversation content when the lead HAS responded.
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
- "Information Requested" - Lead asks for more details ("tell me more", "what do you have?", "let's talk", "let's connect")
- "Not Interested" - Lead explicitly declines or says no to further contact
- "Blacklist" - Lead is hostile, demands removal, threatens legal action, or uses profanity
- "Follow Up" - Lead responded but deferred action ("I'm busy right now", "contact me later", "not right now", "let me think about it", "I'll get back to you") OR gave a simple acknowledgment without commitment ("ok", "thanks", "got it")
- "Out of Office" - Lead mentions being on vacation, traveling, or temporarily unavailable
- "Interested" - Lead shows clear interest or openness ("sure", "sounds good", "I'm interested", "yes", "okay let's do it", "listening to offers", "open to suggestions")
- "Neutral" - Lead's response is genuinely ambiguous with no clear intent
</categories>

<classification_rules>
CRITICAL RULES:
1. "Follow Up" is ONLY for leads who HAVE responded - it means they acknowledged but want to be contacted later
2. Simple acknowledgments like "ok", "thanks", "got it" without clear positive intent → "Follow Up" (they engaged but didn't commit)
3. Affirmative responses like "sure", "sounds good", "yes", "I'm interested" → "Interested"
4. Requests for more info like "tell me more", "let's talk", "what do you offer" → "Information Requested"
5. Deferrals like "I'm busy", "not now", "maybe later", "let me think" → "Follow Up"
6. Only use "Neutral" when the response is truly ambiguous (rare)
7. Only use "Not Interested" for clear rejections, not just silence
8. Only use "Blacklist" for explicit hostility or opt-out demands
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
