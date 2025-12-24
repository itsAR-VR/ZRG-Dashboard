import "@/lib/server-dns";
import { getAIPromptTemplate } from "@/lib/ai/prompt-registry";
import { markAiInteractionError, runResponseWithInteraction } from "@/lib/ai/openai-telemetry";
import { computeAdaptiveMaxOutputTokens } from "@/lib/ai/token-budget";
import { extractJsonObjectFromText, getTrimmedOutputText, summarizeResponseForTelemetry } from "@/lib/ai/response-utils";
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
    const model = "gpt-5-mini";
    const input = [{ role: "user" as const, content: user }];
    const baseBudget = await computeAdaptiveMaxOutputTokens({
      model,
      instructions: system,
      input,
      min: 256,
      max: 900,
      overheadTokens: 256,
      outputScale: 0.2,
      preferApiCount: true,
    });

    const attempts = [
      baseBudget.maxOutputTokens,
      Math.min(Math.max(baseBudget.maxOutputTokens, 512) + 400, 1600),
    ];

    let lastInteractionId: string | null = null;
    let lastErrorMessage: string | null = null;

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
      const { response, interactionId } = await runResponseWithInteraction({
        clientId: opts.clientId,
        leadId: opts.leadId,
        featureId: promptTemplate?.featureId || "auto_reply_gate.decide",
        promptKey:
          (promptTemplate?.key || "auto_reply_gate.decide.v1") + (attemptIndex === 0 ? "" : `.retry${attemptIndex + 1}`),
        params: {
          model,
          reasoning: { effort: "low" },
          max_output_tokens: attempts[attemptIndex],
          instructions: system,
          text: {
            verbosity: "low",
            format: {
              type: "json_schema",
              name: "auto_reply_gate",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  should_reply: { type: "boolean" },
                  reason: { type: "string" },
                  follow_up_time: { type: ["string", "null"] },
                },
                required: ["should_reply", "reason"],
              },
            },
          },
          input,
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

      let parsed: { should_reply: boolean; reason: string; follow_up_time?: string | null };
      try {
        parsed = JSON.parse(extractJsonObjectFromText(text)) as {
          should_reply: boolean;
          reason: string;
          follow_up_time?: string | null;
        };
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

      return {
        shouldReply: Boolean(parsed.should_reply),
        reason: String(parsed.reason || "").slice(0, 240) || "No reason provided",
        ...(parsed.follow_up_time ? { followUpTime: parsed.follow_up_time } : {}),
      };
    }

    if (lastInteractionId && lastErrorMessage) {
      await markAiInteractionError(lastInteractionId, lastErrorMessage);
    }

    return { shouldReply: false, reason: "No decision returned" };
  } catch (error) {
    console.error("[AutoReplyGate] Decision failed:", error);
    return { shouldReply: false, reason: "Decision error" };
  }
}
