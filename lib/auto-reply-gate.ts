import "@/lib/server-dns";
import OpenAI from "openai";
import { isOptOutText } from "@/lib/sentiment";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export type AutoReplyDecision = {
  shouldReply: boolean;
  reason: string;
  followUpTime?: string;
};

function trimForModel(text: string, maxChars = 12000): string {
  const cleaned = (text || "").trim();
  if (!cleaned) return "";
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(cleaned.length - maxChars);
}

function isAckOnly(text: string): boolean {
  const normalized = (text || "").trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.length > 80) return false;
  return /^(thanks|thank you|thx|ok|okay|got it|noted|cool|great|sounds good|👍|👌|k)$/i.test(
    normalized.replace(/[.!?]+$/g, "")
  );
}

export async function decideShouldAutoReply(opts: {
  channel: "email" | "sms" | "linkedin";
  latestInbound: string;
  subject?: string | null;
  conversationHistory: string;
  categorization: string | null;
  automatedReply?: boolean | null;
  replyReceivedAt?: string | Date | null;
}): Promise<AutoReplyDecision> {
  const latestInbound = (opts.latestInbound || "").trim();
  const subject = (opts.subject || "").trim();
  const categorization = (opts.categorization || "").trim();

  // Hard safety: never auto-reply to opt-outs.
  if (isOptOutText(`Subject: ${subject} | ${latestInbound}`)) {
    return { shouldReply: false, reason: "Opt-out/unsubscribe request detected" };
  }

  if (categorization === "Blacklist" || categorization === "Automated Reply") {
    return { shouldReply: false, reason: `Categorized as ${categorization}` };
  }

  if (opts.automatedReply === true && categorization !== "Out of Office") {
    return { shouldReply: false, reason: "Provider flagged as automated reply" };
  }

  if (isAckOnly(latestInbound)) {
    return { shouldReply: false, reason: "Acknowledgement-only reply" };
  }

  // If AI isn't configured, default to safe behavior (no auto-send).
  if (!process.env.OPENAI_API_KEY) {
    return { shouldReply: false, reason: "OPENAI_API_KEY not configured" };
  }

  const system = `You decide whether an inbound reply warrants sending a reply back.

Inputs provided:
1) Reply: the latest inbound message (cleaned)
2) Subject (if email)
3) Conversation history transcript
4) Reply categorization (intent/sentiment)
5) Automated reply flag (if available)
6) Reply received at timestamp

Reasoning framework:
- If categorization is unsubscribe / stop / angry / spam complaint / blacklist → NO
- If categorization is interested / positive / neutral question / referral / meeting requested / call requested / information requested / follow up → YES
- If categorization is not interested / polite decline and no new info is added → NO
- Exception: If categorization is Not Interested but the conversation history shows they were previously interested, reply unless it is a definitive hard no
- If the reply introduces a new question, new info, or a path to progress → YES
- If the reply is an auto-response or simple acknowledgement ("thanks", "got it") → NO
- If conversation history already had a final closing message and the reply doesn't reopen the door → NO

Follow-up time:
- Only include follow_up_time when appropriate.
- If should_reply is true and they are interested, set follow up soon (usually next day).
- If should_reply is false but they explicitly ask for future contact (e.g., "reach out in 3 months"), set follow_up_time accordingly.
- Use ISO format (YYYY-MM-DDTHH:MM:SSZ). If timezone unclear, assume US Central. Never output a time earlier than 8am local.

Output MUST be valid JSON:
{
  "should_reply": true|false,
  "reason": "max 30 words",
  "follow_up_time": "YYYY-MM-DDTHH:MM:SSZ" (optional)
}`;

  const receivedAt =
    typeof opts.replyReceivedAt === "string"
      ? opts.replyReceivedAt
      : opts.replyReceivedAt instanceof Date
        ? opts.replyReceivedAt.toISOString()
        : "";

  const user = JSON.stringify(
    {
      channel: opts.channel,
      subject: subject || null,
      reply: latestInbound,
      conversation_history: trimForModel(opts.conversationHistory || ""),
      reply_categorization: categorization || null,
      automated_reply: opts.automatedReply ?? null,
      reply_received_at: receivedAt || null,
    },
    null,
    2
  );

  try {
    const response = await openai.responses.create({
      model: "gpt-5-mini",
      reasoning: { effort: "low" },
      max_output_tokens: 200,
      instructions: system,
      input: [{ role: "user", content: user }],
    });

    const text = response.output_text?.trim();
    if (!text) {
      return { shouldReply: false, reason: "No decision returned" };
    }

    const jsonText = text.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(jsonText) as {
      should_reply: boolean;
      reason: string;
      follow_up_time?: string;
    };

    return {
      shouldReply: Boolean(parsed.should_reply),
      reason: String(parsed.reason || "").slice(0, 240) || "No reason provided",
      ...(parsed.follow_up_time ? { followUpTime: parsed.follow_up_time } : {}),
    };
  } catch (error) {
    console.error("[AutoReplyGate] Decision failed:", error);
    return { shouldReply: false, reason: "Decision error" };
  }
}

