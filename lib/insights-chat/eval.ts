import "server-only";

import "@/lib/server-dns";
import { runResponseWithInteraction } from "@/lib/ai/openai-telemetry";
import { computeAdaptiveMaxOutputTokens } from "@/lib/ai/token-budget";
import { extractJsonObjectFromText, getTrimmedOutputText, summarizeResponseForTelemetry } from "@/lib/ai/response-utils";
import { z } from "zod";
import type { InsightsChatModel } from "@/lib/insights-chat/config";

/**
 * Advanced-evaluation scaffolding (LLM-as-judge).
 *
 * v1: Not used for gating; stored/returned only if explicitly enabled later.
 * - Direct scoring (1-5) with evidence-first rubric to reduce calibration drift.
 * - Designed to be extended with position-swap pairwise comparisons in v2.
 */

const InsightsAnswerEvalSchema = z.object({
  groundedness: z.object({
    score: z.number().min(1).max(5),
    evidence: z.array(z.string()).max(8),
  }),
  usefulness: z.object({
    score: z.number().min(1).max(5),
    evidence: z.array(z.string()).max(8),
  }),
  clarity: z.object({
    score: z.number().min(1).max(5),
    evidence: z.array(z.string()).max(8),
  }),
  risks: z.array(z.string()).max(8),
  overall: z.object({
    score: z.number().min(1).max(5),
    confidence: z.number().min(0).max(1),
  }),
});

export type InsightsAnswerEvaluation = z.infer<typeof InsightsAnswerEvalSchema>;

const JUDGE_SYSTEM = `You are an expert evaluator for a CRM analytics assistant.

Evaluate the assistant answer against the provided analytics snapshot and context pack.

CRITICAL RULES
- Groundedness matters most: do not reward confident-sounding answers that invent numbers.
- Penalize any claim of actions being taken (writes/changes) when the assistant is read-only.
- Prefer short, actionable, specific recommendations over generic advice.

SCORING (1-5, 5 is best)
- groundedness: Are numbers/claims supported by provided data?
- usefulness: Does it help the user decide what to do next?
- clarity: Is it easy to read and structured?

Return ONLY valid JSON matching this schema:
{
  "groundedness": { "score": 1-5, "evidence": ["..."] },
  "usefulness": { "score": 1-5, "evidence": ["..."] },
  "clarity": { "score": 1-5, "evidence": ["..."] },
  "risks": ["..."],
  "overall": { "score": 1-5, "confidence": 0-1 }
}`;

export async function evaluateInsightsAnswer(opts: {
  clientId: string;
  model: InsightsChatModel;
  question: string;
  analyticsSnapshot: unknown;
  contextPackMarkdown: string;
  answer: string;
}): Promise<InsightsAnswerEvaluation> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const payload = {
    question: opts.question,
    analytics_snapshot: opts.analyticsSnapshot ?? null,
    context_pack: opts.contextPackMarkdown,
    answer: opts.answer,
  };

  const input = [{ role: "user" as const, content: JSON.stringify(payload, null, 2) }];
  const budget = await computeAdaptiveMaxOutputTokens({
    model: opts.model,
    instructions: JUDGE_SYSTEM,
    input,
    min: 450,
    max: 1400,
    overheadTokens: 300,
    outputScale: 0.2,
    preferApiCount: true,
  });

  const { response } = await runResponseWithInteraction({
    clientId: opts.clientId,
    featureId: "insights.answer_judge",
    promptKey: "insights.answer_judge.v1",
    params: {
      model: opts.model,
      reasoning: { effort: "low" },
      max_output_tokens: budget.maxOutputTokens,
      instructions: JUDGE_SYSTEM,
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "insights_answer_eval",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              groundedness: {
                type: "object",
                additionalProperties: false,
                properties: {
                  score: { type: "number" },
                  evidence: { type: "array", items: { type: "string" } },
                },
                required: ["score", "evidence"],
              },
              usefulness: {
                type: "object",
                additionalProperties: false,
                properties: {
                  score: { type: "number" },
                  evidence: { type: "array", items: { type: "string" } },
                },
                required: ["score", "evidence"],
              },
              clarity: {
                type: "object",
                additionalProperties: false,
                properties: {
                  score: { type: "number" },
                  evidence: { type: "array", items: { type: "string" } },
                },
                required: ["score", "evidence"],
              },
              risks: { type: "array", items: { type: "string" } },
              overall: {
                type: "object",
                additionalProperties: false,
                properties: {
                  score: { type: "number" },
                  confidence: { type: "number" },
                },
                required: ["score", "confidence"],
              },
            },
            required: ["groundedness", "usefulness", "clarity", "risks", "overall"],
          },
        },
      },
      input,
    },
    requestOptions: {
      timeout: Math.max(8_000, Number.parseInt(process.env.OPENAI_INSIGHTS_EVAL_TIMEOUT_MS || "45000", 10) || 45_000),
    },
  });

  const text = getTrimmedOutputText(response);
  if (!text) {
    const details = summarizeResponseForTelemetry(response);
    throw new Error(`Empty output_text${details ? ` (${details})` : ""}`);
  }

  const parsed = JSON.parse(extractJsonObjectFromText(text));
  const validated = InsightsAnswerEvalSchema.safeParse(parsed);
  if (!validated.success) throw new Error(`Eval schema mismatch: ${validated.error.message}`);

  return validated.data;
}
