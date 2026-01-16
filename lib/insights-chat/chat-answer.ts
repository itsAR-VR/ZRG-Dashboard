import "server-only";

import "@/lib/server-dns";
import { getAIPromptTemplate } from "@/lib/ai/prompt-registry";
import { computeAdaptiveMaxOutputTokens } from "@/lib/ai/token-budget";
import { extractJsonObjectFromText, getTrimmedOutputText, summarizeResponseForTelemetry } from "@/lib/ai/response-utils";
import { markAiInteractionError, runResponseWithInteraction } from "@/lib/ai/openai-telemetry";
import { z } from "zod";
import type { InsightsChatModel, OpenAIReasoningEffort } from "@/lib/insights-chat/config";
import type { InsightThreadCitation, InsightThreadIndexItem } from "@/lib/insights-chat/citations";

const AnswerSchema = z.object({
  answer_markdown: z.string().max(20_000),
  citations: z
    .array(
      z.object({
        ref: z.string().min(2).max(12),
        note: z.string().max(180).nullable(),
      })
    )
    .max(60),
});

type StructuredAnswer = z.infer<typeof AnswerSchema>;

function safeString(value: string | null | undefined): string {
  return (value || "").trim();
}

function safeJsonParse<T>(text: string): T {
  return JSON.parse(extractJsonObjectFromText(text)) as T;
}

function getInsightsMaxRetries(): number {
  const parsed = Number.parseInt(process.env.OPENAI_INSIGHTS_MAX_RETRIES || "5", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 5;
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
  threadIndex?: InsightThreadIndexItem[] | null;
  recentMessages: Array<{ role: "user" | "assistant"; content: string }>;
  model: InsightsChatModel;
  reasoningEffort: OpenAIReasoningEffort;
}): Promise<{ answer: string; citations: InsightThreadCitation[]; interactionId: string | null }> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const prompt = getAIPromptTemplate("insights.chat_answer.v2");
  const system =
    prompt?.messages.find((m) => m.role === "system")?.content ||
    `You are an analytics insights assistant for a sales outreach dashboard.

RULES:
- Use ONLY the provided analytics snapshot and context pack. Do not invent numbers.
- If data is missing, say what you need.
- Keep it concise and specific.

OUTPUT:
- Output ONLY valid JSON with keys: answer_markdown (string) and citations (array).
- citations must be an array of objects: { ref: string, note: string|null }.
- Use ONLY refs that appear in thread_index.
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
    thread_index: Array.isArray(opts.threadIndex)
      ? opts.threadIndex.map((t) => ({
          ref: t.ref,
          outcome: t.outcome,
          example_type: t.exampleType,
          selection_bucket: t.selectionBucket,
          campaign_name: t.campaignName,
          lead_label: t.leadLabel,
          summary: t.summary,
        }))
      : null,
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
    promptKey: prompt?.key || "insights.chat_answer.v2",
    params: {
      model: opts.model,
      reasoning: { effort: opts.reasoningEffort },
      max_output_tokens: budget.maxOutputTokens,
      instructions: system,
      text: {
        verbosity: "medium",
        format: {
          type: "json_schema",
          name: "insights_chat_answer",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              answer_markdown: { type: "string" },
              citations: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    ref: { type: "string" },
                    note: { anyOf: [{ type: "string" }, { type: "null" }] },
                  },
                  required: ["ref", "note"],
                },
              },
            },
            required: ["answer_markdown", "citations"],
          },
        },
      },
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

  let parsed: StructuredAnswer;
  try {
    parsed = safeJsonParse<StructuredAnswer>(text);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to parse JSON";
    if (interactionId) await markAiInteractionError(interactionId, msg);
    throw new Error(msg);
  }

  const validated = AnswerSchema.safeParse(parsed);
  if (!validated.success) {
    const msg = `Answer schema mismatch: ${validated.error.message}`;
    if (interactionId) await markAiInteractionError(interactionId, msg);
    throw new Error(msg);
  }

  const indexByRef = new Map((opts.threadIndex || []).map((t) => [t.ref.trim().toUpperCase(), t]));
  const citations: InsightThreadCitation[] = [];
  const used = new Set<string>();

  for (const raw of validated.data.citations || []) {
    const ref = (raw.ref || "").trim().toUpperCase();
    if (!ref || used.has(ref)) continue;
    const idx = indexByRef.get(ref);
    if (!idx) continue;
    used.add(ref);
    citations.push({
      kind: "thread",
      ref,
      leadId: idx.leadId,
      outcome: idx.outcome ?? null,
      emailCampaignId: idx.emailCampaignId ?? null,
      campaignName: idx.campaignName ?? null,
      leadLabel: idx.leadLabel ?? null,
      note: raw.note ? String(raw.note) : null,
    });
  }

  return { answer: validated.data.answer_markdown.trim(), citations, interactionId };
}
