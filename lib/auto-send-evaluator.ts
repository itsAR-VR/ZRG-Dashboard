import "@/lib/server-dns";
import { runStructuredJsonPrompt } from "@/lib/ai/prompt-runner";
import { isOptOutText } from "@/lib/sentiment";

export type AutoSendEvaluation = {
  confidence: number;
  safeToSend: boolean;
  requiresHumanReview: boolean;
  reason: string;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function trimForModel(text: string, maxChars = 12000): string {
  const cleaned = (text || "").trim();
  if (!cleaned) return "";
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(cleaned.length - maxChars);
}

export async function evaluateAutoSend(opts: {
  clientId: string;
  leadId?: string | null;
  channel: "email" | "sms" | "linkedin";
  latestInbound: string;
  subject?: string | null;
  conversationHistory: string;
  categorization: string | null;
  automatedReply?: boolean | null;
  replyReceivedAt?: string | Date | null;
  draft: string;
}): Promise<AutoSendEvaluation> {
  const latestInbound = (opts.latestInbound || "").trim();
  const subject = (opts.subject || "").trim();
  const categorization = (opts.categorization || "").trim();
  const draft = (opts.draft || "").trim();

  if (!draft) {
    return {
      confidence: 0,
      safeToSend: false,
      requiresHumanReview: true,
      reason: "Draft is empty",
    };
  }

  // Hard safety: never auto-send to opt-outs.
  if (isOptOutText(`Subject: ${subject} | ${latestInbound}`)) {
    return {
      confidence: 0,
      safeToSend: false,
      requiresHumanReview: true,
      reason: "Opt-out/unsubscribe request detected",
    };
  }

  if (categorization === "Blacklist" || categorization === "Automated Reply") {
    return {
      confidence: 0,
      safeToSend: false,
      requiresHumanReview: true,
      reason: `Categorized as ${categorization}`,
    };
  }

  if (opts.automatedReply === true && categorization !== "Out of Office") {
    return {
      confidence: 0,
      safeToSend: false,
      requiresHumanReview: true,
      reason: "Provider flagged as automated reply",
    };
  }

  // If AI isn't configured, default to safe behavior (no auto-send).
  if (!process.env.OPENAI_API_KEY) {
    return {
      confidence: 0,
      safeToSend: false,
      requiresHumanReview: true,
      reason: "OPENAI_API_KEY not configured",
    };
  }

  const receivedAt =
    typeof opts.replyReceivedAt === "string"
      ? opts.replyReceivedAt
      : opts.replyReceivedAt instanceof Date
        ? opts.replyReceivedAt.toISOString()
        : "";

  const systemFallback = `Return ONLY valid JSON:
{
  "safe_to_send": true|false,
  "requires_human_review": true|false,
  "confidence": number,
  "reason": "string"
}`;

  const user = JSON.stringify(
    {
      channel: opts.channel,
      subject: subject || null,
      latest_inbound: latestInbound,
      conversation_history: trimForModel(opts.conversationHistory || ""),
      reply_categorization: categorization || null,
      automated_reply: opts.automatedReply ?? null,
      reply_received_at: receivedAt || null,
      draft_reply: draft,
    },
    null,
    2
  );

  const timeoutMs = Math.max(
    5_000,
    Number.parseInt(process.env.OPENAI_AUTO_SEND_EVALUATOR_TIMEOUT_MS || "20000", 10) || 20_000
  );

  const result = await runStructuredJsonPrompt<{
    safe_to_send: boolean;
    requires_human_review: boolean;
    confidence: number;
    reason: string;
  }>({
    pattern: "structured_json",
    clientId: opts.clientId,
    leadId: opts.leadId,
    featureId: "auto_send.evaluate",
    promptKey: "auto_send.evaluate.v1",
    model: "gpt-5-mini",
    reasoningEffort: "low",
    systemFallback,
    input: [{ role: "user" as const, content: user }],
    schemaName: "auto_send_evaluator",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        safe_to_send: { type: "boolean" },
        requires_human_review: { type: "boolean" },
        confidence: { type: "number" },
        reason: { type: "string" },
      },
      required: ["safe_to_send", "requires_human_review", "confidence", "reason"],
    },
    budget: {
      min: 256,
      max: 900,
      retryMax: 1600,
      overheadTokens: 256,
      outputScale: 0.18,
      preferApiCount: true,
    },
    timeoutMs,
    maxRetries: 0,
    validate: (value) => {
      const anyValue = value as any;
      if (!anyValue || typeof anyValue !== "object") return { success: false, error: "not an object" };
      if (typeof anyValue.safe_to_send !== "boolean") return { success: false, error: "safe_to_send must be boolean" };
      if (typeof anyValue.requires_human_review !== "boolean") return { success: false, error: "requires_human_review must be boolean" };
      if (typeof anyValue.confidence !== "number" || !Number.isFinite(anyValue.confidence)) return { success: false, error: "confidence must be number" };
      if (typeof anyValue.reason !== "string") return { success: false, error: "reason must be string" };
      return {
        success: true,
        data: {
          safe_to_send: anyValue.safe_to_send,
          requires_human_review: anyValue.requires_human_review,
          confidence: anyValue.confidence,
          reason: anyValue.reason,
        },
      };
    },
  });

  if (!result.success) {
    if (result.error.category === "timeout" || result.error.category === "rate_limit" || result.error.category === "api_error") {
      console.error("[AutoSendEvaluator] Failed:", result.error.message);
      return {
        confidence: 0,
        safeToSend: false,
        requiresHumanReview: true,
        reason: "Evaluation error",
      };
    }
    return {
      confidence: 0,
      safeToSend: false,
      requiresHumanReview: true,
      reason: "No evaluation returned",
    };
  }

  const confidence = clamp01(Number(result.data.confidence));
  const safeToSend = Boolean(result.data.safe_to_send) && confidence >= 0.01;
  const requiresHumanReview = Boolean(result.data.requires_human_review) || !safeToSend;

  return {
    confidence,
    safeToSend,
    requiresHumanReview,
    reason: String(result.data.reason || "").slice(0, 320) || "No reason provided",
  };
}
