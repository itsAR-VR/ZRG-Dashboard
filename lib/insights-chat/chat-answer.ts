import "server-only";

import "@/lib/server-dns";
import { getAIPromptTemplate } from "@/lib/ai/prompt-registry";
import { computeAdaptiveMaxOutputTokens } from "@/lib/ai/token-budget";
import { getTrimmedOutputText, summarizeResponseForTelemetry } from "@/lib/ai/response-utils";
import { markAiInteractionError, runResponseWithInteraction } from "@/lib/ai/openai-telemetry";
import type { InsightsChatModel, OpenAIReasoningEffort } from "@/lib/insights-chat/config";

function safeString(value: string | null | undefined): string {
  return (value || "").trim();
}

function getInsightsMaxRetries(): number {
  const parsed = Number.parseInt(process.env.OPENAI_INSIGHTS_MAX_RETRIES || "2", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 2;
  return Math.min(10, Math.trunc(parsed));
}

export async function answerInsightsChatQuestion(opts: {
  clientId: string;
  sessionId: string;
  question: string;
  windowLabel: string;
  campaignContextLabel: string;
  analyticsSnapshot: unknown;
  contextPackMarkdown: string;
  recentMessages: Array<{ role: "user" | "assistant"; content: string }>;
  model: InsightsChatModel;
  reasoningEffort: OpenAIReasoningEffort;
}): Promise<{ answer: string; interactionId: string | null }> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const prompt = getAIPromptTemplate("insights.chat_answer.v1");
  const system =
    prompt?.messages.find((m) => m.role === "system")?.content ||
    `You are an analytics insights assistant for a sales outreach dashboard.

RULES:
- Use ONLY the provided analytics snapshot and context pack. Do not invent numbers.
- If data is missing, say what you need.
- Keep it concise and specific.
`;

  const question = safeString(opts.question);
  if (!question) throw new Error("Question is empty");

  const history = opts.recentMessages
    .slice(-12)
    .map((m) => `${m.role.toUpperCase()}: ${safeString(m.content)}`)
    .filter(Boolean)
    .join("\n");

  const inputPayload = {
    question,
    window: opts.windowLabel,
    campaign_scope: opts.campaignContextLabel,
    analytics_snapshot: opts.analyticsSnapshot ?? null,
    context_pack: opts.contextPackMarkdown,
    recent_chat: history || null,
  };

  const input = [{ role: "user" as const, content: JSON.stringify(inputPayload, null, 2) }];

  const budget = await computeAdaptiveMaxOutputTokens({
    model: opts.model,
    instructions: system,
    input,
    min: 700,
    max: 2400,
    overheadTokens: 520,
    outputScale: 0.22,
    preferApiCount: true,
  });

  const { response, interactionId } = await runResponseWithInteraction({
    clientId: opts.clientId,
    featureId: prompt?.featureId || "insights.chat_answer",
    promptKey: prompt?.key || "insights.chat_answer.v1",
    params: {
      model: opts.model,
      reasoning: { effort: opts.reasoningEffort },
      max_output_tokens: budget.maxOutputTokens,
      instructions: system,
      text: { verbosity: "medium" },
      input,
    },
    requestOptions: {
      timeout: Math.max(8_000, Number.parseInt(process.env.OPENAI_INSIGHTS_ANSWER_TIMEOUT_MS || "90000", 10) || 90_000),
      maxRetries: getInsightsMaxRetries(),
    },
  });

  const text = getTrimmedOutputText(response);
  if (!text) {
    const details = summarizeResponseForTelemetry(response);
    const msg = `Empty output_text${details ? ` (${details})` : ""}`;
    if (interactionId) await markAiInteractionError(interactionId, msg);
    throw new Error(msg);
  }

  return { answer: text, interactionId };
}
