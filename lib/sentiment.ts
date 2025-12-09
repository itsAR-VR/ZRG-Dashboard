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
  "Positive",
  "Neutral",
  "Interested", // From EmailBison LEAD_INTERESTED events
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
  "Positive": "qualified",
  "Neutral": "new",
  "Interested": "qualified", // From EmailBison
  "Snoozed": "new", // Temporarily hidden from follow-up list
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Classify conversation sentiment using OpenAI
 * Explicitly handles nuanced “open to offers” cases to avoid false negatives.
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
You are a sales conversation classifier. Analyze the conversation transcript and classify it into ONE category.
</task>

<categories>
- "Meeting Requested" - Lead wants to schedule a meeting or video call
- "Call Requested" - Lead provides a phone number or explicitly asks for a phone call
- "Information Requested" - Lead asks for more details/information, or signals openness to continue the conversation (e.g., "let's talk", "let's connect", "let's chat", "tell me more", "what do you have?")
- "Not Interested" - Lead explicitly declines or wants no further contact
- "Blacklist" - Lead explicitly asks to stop contact, unsubscribe, or uses profanity/threats
- "Follow Up" - Lead is somewhat open but defers, asks to revisit later, or gives a soft "not now"
- "Out of Office" - Lead mentions being away/unavailable
- "Positive" - Lead shows general openness/interest without a specific request (e.g., "sure", "sounds good", "I'm interested", "okay", "yes", "listening to offers", "open to suggestions")
- "Neutral" - Pure acknowledgment with no clear positive or negative intent (e.g., "ok", "got it", "received")
</categories>

<classification_rules>
- Short affirmative responses like "sure", "sounds good", "I'm interested", "yes", "okay" → "Positive", NOT "Neutral"
- Responses like "let's talk", "let's connect", "let's chat" → "Information Requested"
- "always listening to offers", "open to suggestions", "give me your offer" → "Positive" (or "Follow Up" if they defer)
- Only use "Not Interested" when the lead clearly declines or asks to stop
- Only use "Neutral" for pure acknowledgments with no sentiment signal
- Use "Blacklist" only for explicit opt-out requests or abusive language
- When in doubt between "Neutral" and "Positive", prefer "Positive"
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

    return "Neutral";
  } catch (error) {
    console.error("OpenAI classification error:", error);
    return "Neutral";
  }
}

