import "server-only";

import { prisma } from "@/lib/prisma";
import { runStructuredJsonPrompt } from "@/lib/ai/prompt-runner";
import { SNIPPET_DEFAULTS } from "@/lib/ai/prompt-snippets";
import { listAIPromptTemplates } from "@/lib/ai/prompt-registry";
import { getLeadMemoryContext } from "@/lib/lead-memory-context";
import {
  buildMessagePerformanceDataset,
  type MessagePerformanceRow,
  type MessagePerformanceOutcome,
  type MessagePerformanceSender,
} from "@/lib/message-performance";
import { buildMessagePerformanceEvidenceSample, type MessagePerformanceEvidenceSample } from "@/lib/message-performance-evidence";
import type { MessagePerformanceProposalType } from "@prisma/client";

type MessagePerformanceScore = {
  booking_likelihood: number;
  clarity_score: number;
  cta_strength: number;
  tone_fit: number;
  strengths: string[];
  issues: string[];
};

type MessagePerformancePairwise = {
  winner: "A" | "B" | "tie";
  key_differences: string[];
  why_it_matters: string[];
  recommended_changes: string[];
};

type MessagePerformanceProposalCandidate = {
  type: MessagePerformanceProposalType;
  title: string;
  summary: string;
  confidence: number;
  target: {
    promptKey?: string;
    role?: "system" | "assistant" | "user";
    index?: number;
    snippetKey?: string;
    assetName?: string;
    assetId?: string;
  };
  content: string;
};

const SCORE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["booking_likelihood", "clarity_score", "cta_strength", "tone_fit"],
  properties: {
    booking_likelihood: { type: "number", minimum: 0, maximum: 1 },
    clarity_score: { type: "number", minimum: 0, maximum: 1 },
    cta_strength: { type: "number", minimum: 0, maximum: 1 },
    tone_fit: { type: "number", minimum: 0, maximum: 1 },
    strengths: { type: "array", items: { type: "string" }, default: [] },
    issues: { type: "array", items: { type: "string" }, default: [] },
  },
};

const PAIRWISE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["winner", "key_differences", "why_it_matters", "recommended_changes"],
  properties: {
    winner: { type: "string", enum: ["A", "B", "tie"] },
    key_differences: { type: "array", items: { type: "string" } },
    why_it_matters: { type: "array", items: { type: "string" } },
    recommended_changes: { type: "array", items: { type: "string" } },
  },
};

const PROPOSALS_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["proposals"],
  properties: {
    proposals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "title", "summary", "confidence", "content"],
        properties: {
          type: { type: "string", enum: ["PROMPT_OVERRIDE", "PROMPT_SNIPPET", "KNOWLEDGE_ASSET"] },
          title: { type: "string" },
          summary: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          target: {
            type: "object",
            additionalProperties: false,
            properties: {
              promptKey: { type: "string" },
              role: { type: "string", enum: ["system", "assistant", "user"] },
              index: { type: "number" },
              snippetKey: { type: "string" },
              assetName: { type: "string" },
              assetId: { type: "string" },
            },
          },
          content: { type: "string" },
        },
      },
    },
    notes: { type: "array", items: { type: "string" }, default: [] },
  },
};

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function summarizeScores(
  scores: Array<{ outcome: MessagePerformanceOutcome; sentBy: MessagePerformanceSender; score: MessagePerformanceScore }>
) {
  const buckets = new Map<string, number[]>();
  for (const entry of scores) {
    const key = `${entry.sentBy}:${entry.outcome}`;
    const list = buckets.get(key) ?? [];
    list.push(entry.score.booking_likelihood);
    buckets.set(key, list);
  }
  const summary: Record<string, number> = {};
  for (const [key, list] of buckets.entries()) {
    summary[key] = average(list);
  }
  return summary;
}

function buildPairCandidates(samples: MessagePerformanceEvidenceSample[]): Array<{ a: MessagePerformanceEvidenceSample; b: MessagePerformanceEvidenceSample }> {
  const byChannelSender = new Map<string, { booked: MessagePerformanceEvidenceSample[]; notBooked: MessagePerformanceEvidenceSample[] }>();

  for (const sample of samples) {
    const key = `${sample.channel}:${sample.sentBy}`;
    const bucket = byChannelSender.get(key) ?? { booked: [], notBooked: [] };
    if (sample.outcome === "BOOKED") bucket.booked.push(sample);
    if (sample.outcome === "NOT_BOOKED") bucket.notBooked.push(sample);
    byChannelSender.set(key, bucket);
  }

  const pairs: Array<{ a: MessagePerformanceEvidenceSample; b: MessagePerformanceEvidenceSample }> = [];
  for (const bucket of byChannelSender.values()) {
    const booked = bucket.booked[0];
    const notBooked = bucket.notBooked[0];
    if (booked && notBooked) pairs.push({ a: booked, b: notBooked });
  }
  return pairs;
}

function resolveProposalPromptKeys(): string[] {
  const templates = listAIPromptTemplates();
  const allow = new Set<string>();
  for (const t of templates) {
    if (
      t.key.startsWith("draft.generate") ||
      t.key.startsWith("draft.verify") ||
      t.key.startsWith("auto_send.evaluate") ||
      t.key.startsWith("meeting.overseer.gate")
    ) {
      allow.add(t.key);
    }
  }
  return Array.from(allow);
}

function resolveProposalSnippetKeys(): string[] {
  return Object.keys(SNIPPET_DEFAULTS);
}

async function enrichSamplesWithMemory(samples: MessagePerformanceEvidenceSample[], clientId: string): Promise<Array<MessagePerformanceEvidenceSample & { memoryContext: string }>> {
  const enriched: Array<MessagePerformanceEvidenceSample & { memoryContext: string }> = [];
  for (const sample of samples) {
    const memory = await getLeadMemoryContext({
      clientId,
      leadId: sample.leadId,
      maxTokens: 120,
      redact: true,
    });
    enriched.push({ ...sample, memoryContext: memory.context || "" });
  }
  return enriched;
}

export async function runMessagePerformanceEvaluationSystem(opts: {
  clientId: string;
  windowFrom: Date;
  windowTo: Date;
  computedByUserId?: string | null;
  computedByEmail?: string | null;
}): Promise<{ runId: string; proposalsCreated: number }> {
  const run = await prisma.messagePerformanceEvalRun.create({
    data: {
      clientId: opts.clientId,
      windowFrom: opts.windowFrom,
      windowTo: opts.windowTo,
      status: "PENDING",
      model: "gpt-5-mini",
      reasoningEffort: "medium",
      computedByUserId: opts.computedByUserId ?? null,
      computedByEmail: opts.computedByEmail ?? null,
    },
    select: { id: true },
  });

  try {
    const samplePerBucket = parsePositiveIntEnv("MESSAGE_PERFORMANCE_EVAL_SAMPLE_PER_BUCKET", 2);
    const maxTotalSamples = parsePositiveIntEnv("MESSAGE_PERFORMANCE_EVAL_MAX_SAMPLES", 20);
    const maxPairwise = parsePositiveIntEnv("MESSAGE_PERFORMANCE_EVAL_MAX_PAIRS", 8);

    const result = await buildMessagePerformanceDataset({
      clientId: opts.clientId,
      windowFrom: opts.windowFrom,
      windowTo: opts.windowTo,
    });

    const sample = await buildMessagePerformanceEvidenceSample({
      clientId: opts.clientId,
      rows: result.rows,
      attributionType: "cross_channel",
      maxPerBucket: samplePerBucket,
      maxTotal: maxTotalSamples,
    });

    const enrichedSamples = await enrichSamplesWithMemory(sample.samples, opts.clientId);

    const scores: Array<{ sample: MessagePerformanceEvidenceSample; score: MessagePerformanceScore }> = [];
    for (const sampleRow of enrichedSamples) {
      const inputJson = JSON.stringify({
        message: sampleRow.snippet,
        channel: sampleRow.channel,
        sentBy: sampleRow.sentBy,
        outcome: sampleRow.outcome,
        memoryContext: sampleRow.memoryContext,
      });

      const res = await runStructuredJsonPrompt<MessagePerformanceScore>({
        pattern: "structured_json",
        clientId: opts.clientId,
        promptKey: "insights.message_performance.score.v1",
        featureId: "insights.message_performance.score",
        model: "gpt-5-mini",
        reasoningEffort: "medium",
        systemFallback: "You score a single outbound message for booking effectiveness.",
        input: [{ role: "user", content: inputJson }],
        schemaName: "message_performance_score",
        schema: SCORE_SCHEMA,
        budget: { min: 120, max: 350, retryMax: 600 },
      });

      if (res.success) {
        scores.push({ sample: sampleRow, score: res.data });
      }
    }

    const pairCandidates = buildPairCandidates(sample.samples).slice(0, maxPairwise);
    const pairwiseResults: Array<{ pair: { a: string; b: string }; result: MessagePerformancePairwise }> = [];

    for (const pair of pairCandidates) {
      const inputJson = JSON.stringify({
        messageA: { snippet: pair.a.snippet, channel: pair.a.channel, sentBy: pair.a.sentBy, outcome: pair.a.outcome },
        messageB: { snippet: pair.b.snippet, channel: pair.b.channel, sentBy: pair.b.sentBy, outcome: pair.b.outcome },
      });

      const res = await runStructuredJsonPrompt<MessagePerformancePairwise>({
        pattern: "structured_json",
        clientId: opts.clientId,
        promptKey: "insights.message_performance.pairwise.v1",
        featureId: "insights.message_performance.pairwise",
        model: "gpt-5-mini",
        reasoningEffort: "medium",
        systemFallback: "You compare two outbound messages to explain why one is more likely to lead to a booked meeting.",
        input: [{ role: "user", content: inputJson }],
        schemaName: "message_performance_pairwise",
        schema: PAIRWISE_SCHEMA,
        budget: { min: 120, max: 350, retryMax: 600 },
      });

      if (res.success) {
        pairwiseResults.push({ pair: { a: pair.a.messageId, b: pair.b.messageId }, result: res.data });
      }
    }

    const scoreSummary = summarizeScores(
      scores.map((entry) => ({
        outcome: entry.sample.outcome,
        sentBy: entry.sample.sentBy,
        score: entry.score,
      }))
    );

    const allowedPromptKeys = resolveProposalPromptKeys();
    const allowedSnippetKeys = resolveProposalSnippetKeys();

    const proposalsInput = JSON.stringify({
      metrics: result.metrics,
      stats: result.stats,
      scoreSummary,
      pairwiseFindings: pairwiseResults.map((row) => row.result),
      allowedPromptKeys,
      allowedSnippetKeys,
      guidance: [
        "Prefer small, testable edits.",
        "Propose changes only if confidence >= 0.6.",
      ],
    });

    const proposalRes = await runStructuredJsonPrompt<{ proposals: MessagePerformanceProposalCandidate[]; notes?: string[] }>({
      pattern: "structured_json",
      clientId: opts.clientId,
      promptKey: "insights.message_performance.proposals.v1",
      featureId: "insights.message_performance.proposals",
      model: "gpt-5-mini",
      reasoningEffort: "medium",
      systemFallback: "You convert evaluation findings into concrete proposal candidates.",
      input: [{ role: "user", content: proposalsInput }],
      schemaName: "message_performance_proposals",
      schema: PROPOSALS_SCHEMA,
      budget: { min: 200, max: 500, retryMax: 900 },
    });

    const rawProposals = proposalRes.success ? proposalRes.data.proposals : [];
    const proposals = rawProposals.filter((proposal) => {
      if (proposal.type === "PROMPT_OVERRIDE") {
        return proposal.target?.promptKey && allowedPromptKeys.includes(proposal.target.promptKey);
      }
      if (proposal.type === "PROMPT_SNIPPET") {
        return proposal.target?.snippetKey && allowedSnippetKeys.includes(proposal.target.snippetKey);
      }
      return proposal.type === "KNOWLEDGE_ASSET";
    });

    let createdCount = 0;
    for (const proposal of proposals) {
      await prisma.messagePerformanceProposal.create({
        data: {
          clientId: opts.clientId,
          type: proposal.type,
          status: "PENDING",
          title: proposal.title,
          summary: proposal.summary,
          payload: {
            target: proposal.target,
            content: proposal.content,
            confidence: proposal.confidence,
          } as any,
          evidence: {
            scoreSummary,
            pairwise: pairwiseResults.slice(0, 5),
          } as any,
          sourceRunId: run.id,
          createdByUserId: opts.computedByUserId ?? null,
          createdByEmail: opts.computedByEmail ?? null,
        },
      });
      createdCount += 1;
    }

    await prisma.messagePerformanceEvalRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETE",
        metricsSnapshot: {
          metrics: result.metrics,
          stats: result.stats,
        } as any,
        output: {
          scores,
          pairwise: pairwiseResults,
          proposals,
        } as any,
        proposalsCreated: createdCount,
        computedAt: new Date(),
      },
    });

    return { runId: run.id, proposalsCreated: createdCount };
  } catch (error) {
    await prisma.messagePerformanceEvalRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message : "Evaluation failed",
        computedAt: new Date(),
      },
    });
    throw error;
  }
}
