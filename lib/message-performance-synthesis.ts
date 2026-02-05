import "server-only";

import { prisma } from "@/lib/prisma";
import { runStructuredJsonPrompt } from "@/lib/ai/prompt-runner";
import { coerceInsightsChatModel, coerceInsightsChatReasoningEffort } from "@/lib/insights-chat/config";
import type { MessagePerformanceMetrics } from "@/lib/message-performance";
import type { MessagePerformanceEvidenceSample } from "@/lib/message-performance-evidence";

export type MessagePerformanceSynthesis = {
  summary: string;
  highlights: string[];
  patterns: string[];
  antiPatterns: string[];
  recommendations: Array<{
    title: string;
    rationale: string;
    target: "prompt_override" | "prompt_snippet" | "knowledge_asset" | "process";
    confidence: number;
  }>;
  caveats: string[];
  confidence: number;
};

const MessagePerformanceSynthesisSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "recommendations", "confidence"],
  properties: {
    summary: { type: "string" },
    highlights: { type: "array", items: { type: "string" }, default: [] },
    patterns: { type: "array", items: { type: "string" }, default: [] },
    antiPatterns: { type: "array", items: { type: "string" }, default: [] },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "rationale", "target", "confidence"],
        properties: {
          title: { type: "string" },
          rationale: { type: "string" },
          target: { type: "string", enum: ["prompt_override", "prompt_snippet", "knowledge_asset", "process"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    caveats: { type: "array", items: { type: "string" }, default: [] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
};

function isValidSynthesis(value: unknown): value is MessagePerformanceSynthesis {
  if (!value || typeof value !== "object") return false;
  const record = value as MessagePerformanceSynthesis;
  if (typeof record.summary !== "string") return false;
  if (!Array.isArray(record.recommendations)) return false;
  if (typeof record.confidence !== "number") return false;
  return true;
}

export async function synthesizeMessagePerformance(opts: {
  clientId: string;
  windowFrom: Date;
  windowTo: Date;
  metrics: MessagePerformanceMetrics;
  stats: Record<string, unknown>;
  samples: MessagePerformanceEvidenceSample[];
  source?: string;
}): Promise<{ synthesis: MessagePerformanceSynthesis | null; interactionId: string | null }> {
  const settings = await prisma.workspaceSettings.findUnique({
    where: { clientId: opts.clientId },
    select: { insightsChatModel: true, insightsChatReasoningEffort: true },
  });

  const model = coerceInsightsChatModel(settings?.insightsChatModel ?? null);
  const effort = coerceInsightsChatReasoningEffort({
    model,
    storedValue: settings?.insightsChatReasoningEffort ?? null,
  });

  const inputJson = JSON.stringify({
    windowFrom: opts.windowFrom.toISOString(),
    windowTo: opts.windowTo.toISOString(),
    metrics: opts.metrics,
    stats: opts.stats,
    samples: opts.samples,
    guidance: [
      "Do not quote raw message text; summarize patterns without verbatim snippets.",
      "Do not include PII (emails, phone numbers, URLs).",
      "Focus on differences between booked vs not booked and AI vs setter.",
    ],
  });

  const res = await runStructuredJsonPrompt<MessagePerformanceSynthesis>({
    pattern: "structured_json",
    clientId: opts.clientId,
    promptKey: "insights.message_performance.synthesize.v1",
    featureId: "insights.message_performance.synthesize",
    model,
    reasoningEffort: effort.api,
    systemFallback:
      "You analyze message performance metrics and samples. Summarize patterns and recommendations without quoting raw text or PII.",
    input: [{ role: "user", content: inputJson }],
    schemaName: "message_performance_synthesis",
    schema: MessagePerformanceSynthesisSchema,
    budget: { min: 250, max: 700, retryMax: 1200 },
    validate: (value) => (isValidSynthesis(value) ? { success: true, data: value } : { success: false, error: "Invalid synthesis" }),
    source: opts.source ?? "message_performance_synthesis",
  });

  if (!res.success) {
    return { synthesis: null, interactionId: res.telemetry.interactionId ?? null };
  }

  return { synthesis: res.data, interactionId: res.telemetry.interactionId ?? null };
}
