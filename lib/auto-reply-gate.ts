import "@/lib/server-dns";
import { getAIPromptTemplate } from "@/lib/ai/prompt-registry";
import { runResponse } from "@/lib/ai/openai-telemetry";
import { isOptOutText } from "@/lib/sentiment";

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
  clientId: string;
  leadId?: string | null;
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

  const promptTemplate = getAIPromptTemplate("auto_reply_gate.decide.v1");
  const system =
    promptTemplate?.messages.find((m) => m.role === "system")?.content ||
    `You decide whether an inbound reply warrants sending a reply back.

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
    const response = await runResponse({
      clientId: opts.clientId,
      leadId: opts.leadId,
      featureId: promptTemplate?.featureId || "auto_reply_gate.decide",
      promptKey: promptTemplate?.key || "auto_reply_gate.decide.v1",
      params: {
        model: "gpt-5-mini",
        reasoning: { effort: "low" },
        max_output_tokens: 200,
        instructions: system,
        input: [{ role: "user", content: user }],
      },
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
