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
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a sales conversation classifier. Analyze the conversation transcript and classify it into ONE of these categories:

- "Meeting Requested" - Lead wants to schedule a meeting or video call
- "Call Requested" - Lead provides a phone number or explicitly asks for a phone call
- "Information Requested" - Lead asks for more details/information about the product or service
- "Not Interested" - Lead explicitly declines or wants no further contact
- "Blacklist" - Lead explicitly asks to stop contact, unsubscribe, or uses profanity/threats
- "Follow Up" - Lead is somewhat open but defers, asks to revisit later, or gives a soft "not now"
- "Out of Office" - Lead mentions being away/unavailable
- "Positive" - Lead is open/curious/encouraging (e.g., "listening to offers", "open to suggestions", "tell me more") without a firm request
- "Neutral" - Acknowledgment/unclear sentiment without positive or negative intent

Clarifications:
- Treat "always listening to offers", "open to suggestions", "give me your offer" as "Positive" (or "Follow Up" if they explicitly defer timing).
- Only use "Not Interested" when the lead clearly declines or asks to stop; otherwise prefer "Follow Up" or "Neutral".
- Use "Blacklist" only when the lead requests no further contact or uses abusive language.

Respond with ONLY the category name, nothing else.`,
        },
        {
          role: "user",
          content: `Classify this SMS conversation:\n\n${transcript}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 50,
    });

    const result = completion.choices[0]?.message?.content?.trim() as SentimentTag;

    if (result && SENTIMENT_TAGS.includes(result)) {
      return result;
    }

    return "Neutral";
  } catch (error) {
    console.error("OpenAI classification error:", error);
    return "Neutral";
  }
}

