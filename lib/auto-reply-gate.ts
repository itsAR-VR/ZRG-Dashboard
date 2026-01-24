import "@/lib/server-dns";
import { runStructuredJsonPrompt } from "@/lib/ai/prompt-runner";
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

  const systemFallback = `You decide whether an inbound reply warrants sending a reply back.

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

  const timeoutMs = Math.max(
    5_000,
    Number.parseInt(process.env.OPENAI_AUTO_REPLY_TIMEOUT_MS || "25000", 10) || 25_000
  );

  const result = await runStructuredJsonPrompt<{ should_reply: boolean; reason: string; follow_up_time: string | null }>({
    pattern: "structured_json",
    clientId: opts.clientId,
    leadId: opts.leadId,
    featureId: "auto_reply_gate.decide",
    promptKey: "auto_reply_gate.decide.v1",
    model: "gpt-5-mini",
    reasoningEffort: "low",
    systemFallback,
    input: [{ role: "user" as const, content: user }],
    schemaName: "auto_reply_gate",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        should_reply: { type: "boolean" },
        reason: { type: "string" },
        follow_up_time: { type: ["string", "null"] },
      },
      required: ["should_reply", "reason", "follow_up_time"],
    },
    budget: {
      min: 256,
      max: 900,
      retryMax: 1600,
      overheadTokens: 256,
      outputScale: 0.2,
      preferApiCount: true,
    },
    timeoutMs,
    maxRetries: 0,
    validate: (value) => {
      const anyValue = value as any;
      if (!anyValue || typeof anyValue !== "object") return { success: false, error: "not an object" };
      if (typeof anyValue.should_reply !== "boolean") return { success: false, error: "should_reply must be boolean" };
      if (typeof anyValue.reason !== "string") return { success: false, error: "reason must be string" };
      const followUpTime = anyValue.follow_up_time;
      if (!(typeof followUpTime === "string" || followUpTime === null)) {
        return { success: false, error: "follow_up_time must be string|null" };
      }
      return {
        success: true,
        data: {
          should_reply: anyValue.should_reply,
          reason: anyValue.reason,
          follow_up_time: followUpTime,
        },
      };
    },
  });

  if (!result.success) {
    if (result.error.category === "timeout" || result.error.category === "rate_limit" || result.error.category === "api_error") {
      console.error("[AutoReplyGate] Decision failed:", result.error.message);
      return { shouldReply: false, reason: "Decision error" };
    }
    return { shouldReply: false, reason: "No decision returned" };
  }

  return {
    shouldReply: Boolean(result.data.should_reply),
    reason: String(result.data.reason || "").slice(0, 240) || "No reason provided",
    ...(result.data.follow_up_time ? { followUpTime: result.data.follow_up_time } : {}),
  };
}
