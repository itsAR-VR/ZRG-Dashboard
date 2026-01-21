import "@/lib/server-dns";
import { getAIPromptTemplate, getPromptWithOverrides } from "@/lib/ai/prompt-registry";
import { markAiInteractionError, runResponseWithInteraction } from "@/lib/ai/openai-telemetry";
import { computeAdaptiveMaxOutputTokens } from "@/lib/ai/token-budget";
import { extractJsonObjectFromText, getTrimmedOutputText, summarizeResponseForTelemetry } from "@/lib/ai/response-utils";
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

  // Use override-aware prompt lookup (Phase 47i)
  const overrideResult = await getPromptWithOverrides("auto_send.evaluate.v1", opts.clientId);
  const promptTemplate = overrideResult?.template ?? getAIPromptTemplate("auto_send.evaluate.v1");
  const overrideVersion = overrideResult?.overrideVersion ?? null;
  const system =
    promptTemplate?.messages.find((m) => m.role === "system")?.content ||
    `Return ONLY valid JSON:
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

  try {
    const model = "gpt-5-mini";
    const input = [{ role: "user" as const, content: user }];

    const baseBudget = await computeAdaptiveMaxOutputTokens({
      model,
      instructions: system,
      input,
      min: 256,
      max: 900,
      overheadTokens: 256,
      outputScale: 0.18,
      preferApiCount: true,
    });

    const attempts = [
      baseBudget.maxOutputTokens,
      Math.min(Math.max(baseBudget.maxOutputTokens, 512) + 400, 1600),
    ];

    let lastInteractionId: string | null = null;
    let lastErrorMessage: string | null = null;

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
      const timeoutMs = Math.max(
        5_000,
        Number.parseInt(process.env.OPENAI_AUTO_SEND_EVALUATOR_TIMEOUT_MS || "20000", 10) || 20_000
      );

      const { response, interactionId } = await runResponseWithInteraction({
        clientId: opts.clientId,
        leadId: opts.leadId,
        featureId: promptTemplate?.featureId || "auto_send.evaluate",
        promptKey:
          (promptTemplate?.key || "auto_send.evaluate.v1") + (overrideVersion ? `.${overrideVersion}` : "") + (attemptIndex === 0 ? "" : `.retry${attemptIndex + 1}`),
        params: {
          model,
          reasoning: { effort: "low" },
          max_output_tokens: attempts[attemptIndex],
          instructions: system,
          text: {
            verbosity: "low",
            format: {
              type: "json_schema",
              name: "auto_send_evaluator",
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
            },
          },
          input,
        },
        requestOptions: {
          timeout: timeoutMs,
          maxRetries: 0,
        },
      });

      lastInteractionId = interactionId;

      const text = getTrimmedOutputText(response);
      if (!text) {
        const details = summarizeResponseForTelemetry(response);
        lastErrorMessage = `Post-process error: empty output_text${details ? ` (${details})` : ""}`;
        if (response.incomplete_details?.reason === "max_output_tokens" && attemptIndex < attempts.length - 1) {
          continue;
        }
        break;
      }

      let parsed: {
        safe_to_send: boolean;
        requires_human_review: boolean;
        confidence: number;
        reason: string;
      };
      try {
        parsed = JSON.parse(extractJsonObjectFromText(text)) as typeof parsed;
      } catch (parseError) {
        const details = summarizeResponseForTelemetry(response);
        lastErrorMessage = `Post-process error: failed to parse JSON (${parseError instanceof Error ? parseError.message : "unknown"})${
          details ? ` (${details})` : ""
        }`;

        if (attemptIndex < attempts.length - 1) {
          continue;
        }
        break;
      }

      const confidence = clamp01(Number(parsed.confidence));
      const safeToSend = Boolean(parsed.safe_to_send) && confidence >= 0.01;
      const requiresHumanReview = Boolean(parsed.requires_human_review) || !safeToSend;

      return {
        confidence,
        safeToSend,
        requiresHumanReview,
        reason: String(parsed.reason || "").slice(0, 320) || "No reason provided",
      };
    }

    if (lastInteractionId && lastErrorMessage) {
      await markAiInteractionError(lastInteractionId, lastErrorMessage);
    }

    return {
      confidence: 0,
      safeToSend: false,
      requiresHumanReview: true,
      reason: "No evaluation returned",
    };
  } catch (error) {
    console.error("[AutoSendEvaluator] Failed:", error);
    return {
      confidence: 0,
      safeToSend: false,
      requiresHumanReview: true,
      reason: "Evaluation error",
    };
  }
}

