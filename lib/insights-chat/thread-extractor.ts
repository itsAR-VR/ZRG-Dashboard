import "server-only";

import "@/lib/server-dns";
import { prisma } from "@/lib/prisma";
import { getAIPromptTemplate } from "@/lib/ai/prompt-registry";
import { computeAdaptiveMaxOutputTokens } from "@/lib/ai/token-budget";
import { extractJsonObjectFromText, getTrimmedOutputText, summarizeResponseForTelemetry } from "@/lib/ai/response-utils";
import { markAiInteractionError, runResponseWithInteraction } from "@/lib/ai/openai-telemetry";
import { z } from "zod";
import type { ConversationInsightOutcome } from "@prisma/client";
import { formatLeadTranscript } from "@/lib/insights-chat/transcript";
import type { InsightsChatModel, OpenAIReasoningEffort } from "@/lib/insights-chat/config";

const ChunkCompressionSchema = z.object({
  key_events: z.array(z.string()).max(12),
  key_phrases: z.array(z.string()).max(12),
  notable_quotes: z.array(z.string()).max(8),
});

export type ThreadChunkCompression = z.infer<typeof ChunkCompressionSchema>;

const ConversationInsightSchema = z.object({
  summary: z.string().max(1200),
  key_events: z.array(z.string()).max(18),
  what_worked: z.array(z.string()).max(14),
  what_failed: z.array(z.string()).max(14),
  key_phrases: z.array(z.string()).max(18),
  evidence_quotes: z.array(z.string()).max(10),
  recommended_tests: z.array(z.string()).max(12),
});

export type ConversationInsight = z.infer<typeof ConversationInsightSchema>;

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

function safeJsonParse<T>(text: string): T {
  return JSON.parse(extractJsonObjectFromText(text)) as T;
}

async function runStructuredJson<T>(opts: {
  clientId: string;
  leadId: string;
  featureId: string;
  promptKey: string;
  model: InsightsChatModel;
  reasoningEffort: OpenAIReasoningEffort;
  instructions: string;
  input: Array<{ role: "user"; content: string }>;
  jsonSchema: Record<string, unknown>;
  maxOutputTokens: number;
  timeoutMs: number;
}): Promise<{ parsed: T; interactionId: string | null }> {
  const { response, interactionId } = await runResponseWithInteraction({
    clientId: opts.clientId,
    leadId: opts.leadId,
    featureId: opts.featureId,
    promptKey: opts.promptKey,
    params: {
      model: opts.model,
      reasoning: { effort: opts.reasoningEffort },
      max_output_tokens: opts.maxOutputTokens,
      instructions: opts.instructions,
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "insights_json",
          strict: true,
          schema: opts.jsonSchema,
        },
      },
      input: opts.input,
    },
    requestOptions: {
      timeout: opts.timeoutMs,
    },
  });

  const text = getTrimmedOutputText(response);
  if (!text) {
    const details = summarizeResponseForTelemetry(response);
    throw new Error(`Empty output_text${details ? ` (${details})` : ""}`);
  }

  return { parsed: safeJsonParse<T>(text), interactionId };
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

  const { header, transcript, lastMessages } = formatLeadTranscript({
    lead,
    campaign: lead.emailCampaign ? { id: lead.emailCampaign.id, name: lead.emailCampaign.name } : null,
    messages,
  });

  const sourceMessageCount = messages.length;
  const sourceLastMessageAt = messages.length ? messages[messages.length - 1]!.sentAt : null;

  const extractPrompt = getAIPromptTemplate("insights.thread_extract.v1");
  const compressPrompt = getAIPromptTemplate("insights.thread_compress.v1");

  const extractSystem =
    extractPrompt?.messages.find((m) => m.role === "system")?.content ||
    "Return ONLY valid JSON with keys: summary, key_events, what_worked, what_failed, key_phrases, evidence_quotes, recommended_tests.";

  const compressSystem =
    compressPrompt?.messages.find((m) => m.role === "system")?.content ||
    "Return ONLY valid JSON with keys: key_events, key_phrases, notable_quotes.";

  const maxTranscriptChars = 28_000;
  let transcriptForModel = transcript;

  if (transcriptForModel.length > maxTranscriptChars) {
    const chunks = splitIntoChunks(transcriptForModel, { chunkSize: 12_000, overlap: 1_200 }).slice(0, 12);
    const compressed: ThreadChunkCompression[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunkInput = JSON.stringify(
        {
          header: JSON.parse(header) as unknown,
          chunk_index: i + 1,
          chunk_count: chunks.length,
          transcript_chunk: chunks[i],
        },
        null,
        2
      );

      const baseBudget = await computeAdaptiveMaxOutputTokens({
        model: opts.model,
        instructions: compressSystem,
        input: [{ role: "user", content: chunkInput }],
        min: 220,
        max: 700,
        overheadTokens: 200,
        outputScale: 0.18,
        preferApiCount: true,
      });

      const timeoutMs = Math.max(5_000, Number.parseInt(process.env.OPENAI_INSIGHTS_THREAD_TIMEOUT_MS || "90000", 10) || 90_000);

      const { parsed } = await runStructuredJson<ThreadChunkCompression>({
        clientId: opts.clientId,
        leadId: opts.leadId,
        featureId: compressPrompt?.featureId || "insights.thread_compress",
        promptKey: compressPrompt?.key || "insights.thread_compress.v1",
        model: opts.model,
        reasoningEffort: opts.reasoningEffort,
        instructions: compressSystem,
        input: [{ role: "user", content: chunkInput }],
        jsonSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            key_events: { type: "array", items: { type: "string" } },
            key_phrases: { type: "array", items: { type: "string" } },
            notable_quotes: { type: "array", items: { type: "string" } },
          },
          required: ["key_events", "key_phrases", "notable_quotes"],
        },
        maxOutputTokens: baseBudget.maxOutputTokens,
        timeoutMs,
      });

      const validated = ChunkCompressionSchema.safeParse(parsed);
      if (!validated.success) {
        throw new Error(`Chunk compression schema mismatch: ${validated.error.message}`);
      }
      compressed.push(validated.data);
    }

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
      header: JSON.parse(header) as unknown,
      outcome: opts.outcome,
      sentimentTag: lead.sentimentTag || null,
      transcript: transcriptForModel,
      last_messages: lastMessages,
    },
    null,
    2
  );

  const baseBudget = await computeAdaptiveMaxOutputTokens({
    model: opts.model,
    instructions: extractSystem,
    input: [{ role: "user", content: extractInput }],
    min: 600,
    max: 1800,
    overheadTokens: 420,
    outputScale: 0.22,
    preferApiCount: true,
  });

  const attempts = [baseBudget.maxOutputTokens, Math.min(baseBudget.maxOutputTokens + 700, 2600)];
  let lastInteractionId: string | null = null;
  let lastErrorMessage: string | null = null;

  for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
    const timeoutMs = Math.max(5_000, Number.parseInt(process.env.OPENAI_INSIGHTS_THREAD_TIMEOUT_MS || "90000", 10) || 90_000);

    try {
      const { parsed, interactionId } = await runStructuredJson<ConversationInsight>({
        clientId: opts.clientId,
        leadId: opts.leadId,
        featureId: extractPrompt?.featureId || "insights.thread_extract",
        promptKey:
          (extractPrompt?.key || "insights.thread_extract.v1") + (attemptIndex === 0 ? "" : `.retry${attemptIndex + 1}`),
        model: opts.model,
        reasoningEffort: opts.reasoningEffort,
        instructions: extractSystem,
        input: [{ role: "user", content: extractInput }],
        jsonSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            summary: { type: "string" },
            key_events: { type: "array", items: { type: "string" } },
            what_worked: { type: "array", items: { type: "string" } },
            what_failed: { type: "array", items: { type: "string" } },
            key_phrases: { type: "array", items: { type: "string" } },
            evidence_quotes: { type: "array", items: { type: "string" } },
            recommended_tests: { type: "array", items: { type: "string" } },
          },
          required: ["summary", "key_events", "what_worked", "what_failed", "key_phrases", "evidence_quotes", "recommended_tests"],
        },
        maxOutputTokens: attempts[attemptIndex],
        timeoutMs,
      });

      lastInteractionId = interactionId;

      const validated = ConversationInsightSchema.safeParse(parsed);
      if (!validated.success) {
        throw new Error(`Conversation insight schema mismatch: ${validated.error.message}`);
      }

      return {
        insight: validated.data,
        sourceMessageCount,
        sourceLastMessageAt,
        interactionId,
      };
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : "Unknown error";
      if (attemptIndex < attempts.length - 1) continue;
    }
  }

  if (lastInteractionId && lastErrorMessage) {
    await markAiInteractionError(lastInteractionId, lastErrorMessage);
  }

  throw new Error(lastErrorMessage || "Failed to extract conversation insight");
}
