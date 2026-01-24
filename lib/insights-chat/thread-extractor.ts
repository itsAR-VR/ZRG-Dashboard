import "server-only";

import "@/lib/server-dns";
import { prisma } from "@/lib/prisma";
import { getAIPromptTemplate } from "@/lib/ai/prompt-registry";
import { runStructuredJsonPrompt } from "@/lib/ai/prompt-runner";
import { z } from "zod";
import type { ConversationInsightOutcome } from "@prisma/client";
import { formatLeadTranscript, type ClassifiedTranscriptMessage } from "@/lib/insights-chat/transcript";
import type { InsightsChatModel, OpenAIReasoningEffort } from "@/lib/insights-chat/config";

// ============================================================================
// Schema Version for Backfill Detection (Phase 29e)
// ============================================================================

/**
 * Current schema version for conversation insights.
 * Bump this when the schema changes meaningfully to trigger re-extraction of cached insights.
 */
export const CONVERSATION_INSIGHT_SCHEMA_VERSION = "v2_followup_weighting" as const;

const ChunkCompressionSchema = z.object({
  key_events: z.array(z.string()).max(12),
  key_phrases: z.array(z.string()).max(12),
  notable_quotes: z.array(z.string()).max(8),
});

export type ThreadChunkCompression = z.infer<typeof ChunkCompressionSchema>;

// ============================================================================
// Objection Type Taxonomy (for follow-up response mapping)
// ============================================================================

/**
 * Lightweight taxonomy for objection types in sales conversations.
 */
export const OBJECTION_TYPES = [
  "pricing", // cost, budget, ROI concerns
  "timing", // not now, busy, check back later
  "authority", // need to check with boss/team
  "need", // not sure we need this, already have something
  "trust", // need more info, who are you, references
  "competitor", // using X, happy with current solution
  "none", // no clear objection
] as const;

export type ObjectionType = (typeof OBJECTION_TYPES)[number];

// ============================================================================
// Follow-Up Response Schemas (Phase 29b)
// ============================================================================

/**
 * Schema for objection-response mapping within follow-up analysis.
 */
const ObjectionResponseSchema = z.object({
  objection_type: z.enum(OBJECTION_TYPES),
  agent_response: z.string().max(300),
  outcome: z.enum(["positive", "negative", "neutral"]),
});

/**
 * Schema for follow-up specific analysis.
 */
const FollowUpAnalysisSchema = z.object({
  what_worked: z.array(z.string()).max(10),
  what_failed: z.array(z.string()).max(10),
  key_phrases: z.array(z.string()).max(12),
  tone_observations: z.array(z.string()).max(6),
  objection_responses: z.array(ObjectionResponseSchema).max(8),
});

/**
 * Schema for follow-up effectiveness scoring.
 */
const FollowUpEffectivenessSchema = z.object({
  score: z.number().min(0).max(100),
  converted_after_objection: z.boolean(),
  notes: z.array(z.string()).max(5),
});

// ============================================================================
// Conversation Insight Schema (v2 with follow-up weighting)
// ============================================================================

const ConversationInsightSchema = z.object({
  // Schema version for backfill detection
  schema_version: z.literal(CONVERSATION_INSIGHT_SCHEMA_VERSION).optional(),

  // Original v1 fields (preserved for backwards compatibility)
  summary: z.string().max(1200),
  key_events: z.array(z.string()).max(18),
  what_worked: z.array(z.string()).max(14),
  what_failed: z.array(z.string()).max(14),
  key_phrases: z.array(z.string()).max(18),
  evidence_quotes: z.array(z.string()).max(10),
  recommended_tests: z.array(z.string()).max(12),

  // NEW: Follow-up specific analysis (Phase 29b)
  follow_up: FollowUpAnalysisSchema.optional(),

  // NEW: Follow-up effectiveness scoring (Phase 29b)
  follow_up_effectiveness: FollowUpEffectivenessSchema.nullable().optional(),
});

export type ConversationInsight = z.infer<typeof ConversationInsightSchema>;
export type FollowUpAnalysis = z.infer<typeof FollowUpAnalysisSchema>;
export type FollowUpEffectiveness = z.infer<typeof FollowUpEffectivenessSchema>;
export type ObjectionResponse = z.infer<typeof ObjectionResponseSchema>;

// ============================================================================
// Follow-Up Stats Computation (deterministic, no AI)
// ============================================================================

/**
 * Compute follow-up statistics from classified messages.
 */
export function computeFollowUpStats(messages: ClassifiedTranscriptMessage[]): {
  hasFollowUp: boolean;
  followUpCount: number;
  initialOutboundCount: number;
  inboundCount: number;
} {
  let followUpCount = 0;
  let initialOutboundCount = 0;
  let inboundCount = 0;

  for (const m of messages) {
    switch (m.responseType) {
      case "follow_up_response":
        followUpCount++;
        break;
      case "initial_outbound":
        initialOutboundCount++;
        break;
      case "inbound":
        inboundCount++;
        break;
    }
  }

  return {
    hasFollowUp: followUpCount > 0,
    followUpCount,
    initialOutboundCount,
    inboundCount,
  };
}

/**
 * Compute base effectiveness score from outcome (deterministic).
 *
 * Base scoring:
 * - Start at 50 points
 * - +40 points: Outcome BOOKED
 * - +25 points: Outcome REQUESTED
 * - -10 points: Outcome STALLED
 * - -25 points: Outcome NO_RESPONSE
 * - ±0 points: UNKNOWN
 *
 * This is a floor/ceiling that the LLM score can adjust within.
 */
export function computeBaseEffectivenessScore(outcome: ConversationInsightOutcome): number {
  const base = 50;
  switch (outcome) {
    case "BOOKED":
      return Math.min(100, base + 40); // 90
    case "REQUESTED":
      return Math.min(100, base + 25); // 75
    case "STALLED":
      return Math.max(0, base - 10); // 40
    case "NO_RESPONSE":
      return Math.max(0, base - 25); // 25
    case "UNKNOWN":
    default:
      return base; // 50
  }
}

function splitIntoChunks(text: string, opts: { chunkSize: number; overlap: number }): string[] {
  const cleaned = (text || "").trim();
  if (!cleaned) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    const end = Math.min(cleaned.length, start + opts.chunkSize);
    chunks.push(cleaned.slice(start, end));
    if (end >= cleaned.length) break;
    start = Math.max(0, end - opts.overlap);
  }
  return chunks;
}

function getChunkCompressionConcurrency(): number {
  const parsed = Number.parseInt(process.env.OPENAI_INSIGHTS_THREAD_CHUNK_CONCURRENCY || "3", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 3;
  return Math.max(1, Math.min(6, Math.trunc(parsed)));
}

function getInsightsMaxRetries(): number {
  const parsed = Number.parseInt(process.env.OPENAI_INSIGHTS_MAX_RETRIES || "5", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 5;
  return Math.min(10, Math.trunc(parsed));
}

async function mapWithConcurrency<TItem, TResult>(
  items: TItem[],
  concurrency: number,
  fn: (item: TItem, index: number) => Promise<TResult>
): Promise<TResult[]> {
  if (items.length === 0) return [];
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) break;
      results[currentIndex] = await fn(items[currentIndex]!, currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

export async function extractConversationInsightForLead(opts: {
  clientId: string;
  leadId: string;
  outcome: ConversationInsightOutcome;
  model: InsightsChatModel;
  reasoningEffort: OpenAIReasoningEffort;
}): Promise<{
  insight: ConversationInsight;
  sourceMessageCount: number;
  sourceLastMessageAt: Date | null;
  interactionId: string | null;
}> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const [lead, messages] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: opts.leadId },
      select: {
        id: true,
        clientId: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        companyName: true,
        industry: true,
        employeeHeadcount: true,
        sentimentTag: true,
        appointmentBookedAt: true,
        emailCampaign: { select: { id: true, name: true } },
      },
    }),
    prisma.message.findMany({
      where: { leadId: opts.leadId },
      select: { id: true, sentAt: true, direction: true, channel: true, sentBy: true, subject: true, body: true },
      orderBy: { sentAt: "asc" },
    }),
  ]);

  if (!lead) throw new Error("Lead not found");
  if (lead.clientId !== opts.clientId) throw new Error("Lead is not in workspace");

  const { header, transcript, lastMessages, classifiedMessages } = formatLeadTranscript({
    lead,
    campaign: lead.emailCampaign ? { id: lead.emailCampaign.id, name: lead.emailCampaign.name } : null,
    messages,
  });

  // Compute follow-up stats for input context
  const followUpStats = computeFollowUpStats(classifiedMessages);

  const sourceMessageCount = messages.length;
  const sourceLastMessageAt = messages.length ? messages[messages.length - 1]!.sentAt : null;

  // Use v2 prompt with follow-up weighting
  const extractPrompt = getAIPromptTemplate("insights.thread_extract.v2");
  const compressPrompt = getAIPromptTemplate("insights.thread_compress.v1");

  const extractSystem =
    extractPrompt?.messages.find((m) => m.role === "system")?.content ||
    "Return ONLY valid JSON with keys: summary, key_events, what_worked, what_failed, key_phrases, evidence_quotes, recommended_tests.";

  const compressSystem =
    compressPrompt?.messages.find((m) => m.role === "system")?.content ||
    "Return ONLY valid JSON with keys: key_events, key_phrases, notable_quotes.";

  const headerObj = JSON.parse(header) as unknown;
  const maxTranscriptChars = 28_000;
  let transcriptForModel = transcript;

  if (transcriptForModel.length > maxTranscriptChars) {
    const chunks = splitIntoChunks(transcriptForModel, { chunkSize: 12_000, overlap: 1_200 }).slice(0, 12);
    const timeoutMs = Math.max(5_000, Number.parseInt(process.env.OPENAI_INSIGHTS_THREAD_TIMEOUT_MS || "90000", 10) || 90_000);
    const concurrency = getChunkCompressionConcurrency();
    const maxRetries = getInsightsMaxRetries();

    const compressed = await mapWithConcurrency(chunks, concurrency, async (chunk, i) => {
      const chunkInput = JSON.stringify(
        {
          header: headerObj,
          chunk_index: i + 1,
          chunk_count: chunks.length,
          transcript_chunk: chunk,
        },
        null,
        2
      );

      const result = await runStructuredJsonPrompt<ThreadChunkCompression>({
        pattern: "structured_json",
        clientId: opts.clientId,
        leadId: opts.leadId,
        featureId: compressPrompt?.featureId || "insights.thread_compress",
        promptKey: compressPrompt?.key || "insights.thread_compress.v1",
        model: opts.model,
        reasoningEffort:
          opts.reasoningEffort === "none" ? undefined : opts.reasoningEffort === "xhigh" ? "high" : opts.reasoningEffort,
        systemFallback: compressSystem,
        input: [{ role: "user" as const, content: chunkInput }],
        schemaName: "insights_thread_chunk_compress",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            key_events: { type: "array", items: { type: "string" } },
            key_phrases: { type: "array", items: { type: "string" } },
            notable_quotes: { type: "array", items: { type: "string" } },
          },
          required: ["key_events", "key_phrases", "notable_quotes"],
        },
        budget: {
          min: 220,
          max: 700,
          overheadTokens: 200,
          outputScale: 0.18,
          preferApiCount: true,
        },
        timeoutMs,
        maxRetries,
        validate: (value) => {
          const validated = ChunkCompressionSchema.safeParse(value);
          if (!validated.success) {
            return { success: false, error: validated.error.message };
          }
          return { success: true, data: validated.data };
        },
      });

      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    });

    transcriptForModel = compressed
      .map((c, idx) => {
        const events = c.key_events.map((v) => `- ${v}`).join("\n");
        const phrases = c.key_phrases.map((v) => `- ${v}`).join("\n");
        const quotes = c.notable_quotes.map((v) => `- ${v}`).join("\n");
        return `# Chunk ${idx + 1}\n\n## Key events\n${events}\n\n## Key phrases\n${phrases}\n\n## Notable quotes\n${quotes}\n`;
      })
      .join("\n")
      .slice(0, 60_000);
  }

  const extractInput = JSON.stringify(
    {
      header: headerObj,
      outcome: opts.outcome,
      sentimentTag: lead.sentimentTag || null,
      // Follow-up stats for model context
      follow_up_stats: {
        has_follow_up: followUpStats.hasFollowUp,
        follow_up_count: followUpStats.followUpCount,
        initial_outbound_count: followUpStats.initialOutboundCount,
        inbound_count: followUpStats.inboundCount,
      },
      transcript: transcriptForModel,
      last_messages: lastMessages,
    },
    null,
    2
  );

  // Build the v2 JSON schema with follow-up fields
  const jsonSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      schema_version: { type: "string", enum: [CONVERSATION_INSIGHT_SCHEMA_VERSION] },
      summary: { type: "string" },
      key_events: { type: "array", items: { type: "string" } },
      what_worked: { type: "array", items: { type: "string" } },
      what_failed: { type: "array", items: { type: "string" } },
      key_phrases: { type: "array", items: { type: "string" } },
      evidence_quotes: { type: "array", items: { type: "string" } },
      recommended_tests: { type: "array", items: { type: "string" } },
      // Follow-up analysis (Phase 29b)
      follow_up: {
        type: "object",
        additionalProperties: false,
        properties: {
          what_worked: { type: "array", items: { type: "string" } },
          what_failed: { type: "array", items: { type: "string" } },
          key_phrases: { type: "array", items: { type: "string" } },
          tone_observations: { type: "array", items: { type: "string" } },
          objection_responses: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                objection_type: {
                  type: "string",
                  enum: ["pricing", "timing", "authority", "need", "trust", "competitor", "none"],
                },
                agent_response: { type: "string" },
                outcome: { type: "string", enum: ["positive", "negative", "neutral"] },
              },
              required: ["objection_type", "agent_response", "outcome"],
            },
          },
        },
        required: ["what_worked", "what_failed", "key_phrases", "tone_observations", "objection_responses"],
      },
      // Follow-up effectiveness (nullable if no follow-up exists)
      follow_up_effectiveness: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            properties: {
              score: { type: "number" },
              converted_after_objection: { type: "boolean" },
              notes: { type: "array", items: { type: "string" } },
            },
            required: ["score", "converted_after_objection", "notes"],
          },
          { type: "null" },
        ],
      },
    },
    required: [
      "schema_version",
      "summary",
      "key_events",
      "what_worked",
      "what_failed",
      "key_phrases",
      "evidence_quotes",
      "recommended_tests",
      "follow_up",
      "follow_up_effectiveness",
    ],
  };

  const timeoutMs = Math.max(5_000, Number.parseInt(process.env.OPENAI_INSIGHTS_THREAD_TIMEOUT_MS || "90000", 10) || 90_000);
  const maxRetries = getInsightsMaxRetries();

  const result = await runStructuredJsonPrompt<ConversationInsight>({
    pattern: "structured_json",
    clientId: opts.clientId,
    leadId: opts.leadId,
    featureId: extractPrompt?.featureId || "insights.thread_extract",
    promptKey: extractPrompt?.key || "insights.thread_extract.v2",
    model: opts.model,
    reasoningEffort:
      opts.reasoningEffort === "none" ? undefined : opts.reasoningEffort === "xhigh" ? "high" : opts.reasoningEffort,
    systemFallback: extractSystem,
    input: [{ role: "user" as const, content: extractInput }],
    schemaName: "insights_thread_extract",
    strict: true,
    schema: jsonSchema,
    budget: {
      min: 800,
      max: 2400,
      retryMax: 3200,
      retryExtraTokens: 900,
      overheadTokens: 520,
      outputScale: 0.25,
      preferApiCount: true,
    },
    timeoutMs,
    maxRetries,
    validate: (value) => {
      const validated = ConversationInsightSchema.safeParse(value);
      if (!validated.success) {
        return { success: false, error: validated.error.message };
      }
      return { success: true, data: validated.data };
    },
  });

  if (!result.success) {
    throw new Error(result.error.message);
  }

  return {
    insight: result.data,
    sourceMessageCount,
    sourceLastMessageAt,
    interactionId: result.telemetry.interactionId,
  };
}
