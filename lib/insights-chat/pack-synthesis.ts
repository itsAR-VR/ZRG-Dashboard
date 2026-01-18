import "server-only";

import "@/lib/server-dns";
import { prisma } from "@/lib/prisma";
import { getAIPromptTemplate } from "@/lib/ai/prompt-registry";
import { computeAdaptiveMaxOutputTokens } from "@/lib/ai/token-budget";
import { extractJsonObjectFromText, getTrimmedOutputText, summarizeResponseForTelemetry } from "@/lib/ai/response-utils";
import { markAiInteractionError, runResponseWithInteraction } from "@/lib/ai/openai-telemetry";
import { z } from "zod";
import type { ConversationInsightOutcome } from "@prisma/client";
import type { ConversationInsight } from "@/lib/insights-chat/thread-extractor";
import type { InsightsChatModel, OpenAIReasoningEffort } from "@/lib/insights-chat/config";

const CampaignSummarySchema = z.object({
  campaign_overview: z.string().max(1200),
  what_worked: z.array(z.string()).max(12),
  what_failed: z.array(z.string()).max(12),
  recommended_experiments: z.array(z.string()).max(12),
  notable_examples: z.array(z.string()).max(12),
});

export type CampaignInsightSummary = z.infer<typeof CampaignSummarySchema>;

const PackSynthesisSchema = z.object({
  pack_markdown: z.string().max(20_000),
  key_takeaways: z.array(z.string()).max(14),
  recommended_experiments: z.array(z.string()).max(14),
  data_gaps: z.array(z.string()).max(10),
});

export type InsightContextPackSynthesis = z.infer<typeof PackSynthesisSchema>;

function safeJsonParse<T>(text: string): T {
  return JSON.parse(extractJsonObjectFromText(text)) as T;
}

function getInsightsMaxRetries(): number {
  const parsed = Number.parseInt(process.env.OPENAI_INSIGHTS_MAX_RETRIES || "5", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 5;
  return Math.min(10, Math.trunc(parsed));
}

function formatLeadLabel(lead: { firstName: string | null; lastName: string | null; email: string | null }): string {
  const name = `${lead.firstName || ""} ${lead.lastName || ""}`.trim();
  const email = (lead.email || "").trim();
  if (name && email) return `${name} <${email}>`;
  if (name) return name;
  if (email) return email;
  return "Unknown lead";
}

/**
 * Compact an insight for synthesis input, preserving follow-up fields (Phase 29d).
 */
function compactInsight(insight: ConversationInsight): {
  summary: string;
  key_events: string[];
  what_worked: string[];
  what_failed: string[];
  key_phrases: string[];
  evidence_quotes: string[];
  // Follow-up fields (Phase 29d)
  follow_up?: {
    what_worked: string[];
    what_failed: string[];
    key_phrases: string[];
    tone_observations: string[];
    objection_responses: Array<{
      objection_type: string;
      agent_response: string;
      outcome: string;
    }>;
  };
  follow_up_effectiveness?: {
    score: number;
    converted_after_objection: boolean;
    notes: string[];
  } | null;
} {
  const base = {
    summary: insight.summary,
    key_events: insight.key_events.slice(0, 10),
    what_worked: insight.what_worked.slice(0, 10),
    what_failed: insight.what_failed.slice(0, 10),
    key_phrases: insight.key_phrases.slice(0, 12),
    evidence_quotes: insight.evidence_quotes.slice(0, 6),
  };

  // Include follow-up data if present (Phase 29d)
  if (insight.follow_up) {
    const followUp = {
      what_worked: insight.follow_up.what_worked?.slice(0, 8) ?? [],
      what_failed: insight.follow_up.what_failed?.slice(0, 6) ?? [],
      key_phrases: insight.follow_up.key_phrases?.slice(0, 8) ?? [],
      tone_observations: insight.follow_up.tone_observations?.slice(0, 4) ?? [],
      objection_responses: insight.follow_up.objection_responses?.slice(0, 5) ?? [],
    };

    return {
      ...base,
      follow_up: followUp,
      follow_up_effectiveness: insight.follow_up_effectiveness ?? null,
    };
  }

  return base;
}

async function runStructuredJson<T>(opts: {
  clientId: string;
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
      maxRetries: getInsightsMaxRetries(),
    },
  });

  const text = getTrimmedOutputText(response);
  if (!text) {
    const details = summarizeResponseForTelemetry(response);
    throw new Error(`Empty output_text${details ? ` (${details})` : ""}`);
  }

  return { parsed: safeJsonParse<T>(text), interactionId };
}

export async function synthesizeInsightContextPack(opts: {
  clientId: string;
  seedQuestion: string;
  windowLabel: string;
  campaignIds: string[];
  analyticsSnapshot: unknown;
  threads: Array<{
    leadId: string;
    outcome: ConversationInsightOutcome;
    insight: ConversationInsight;
  }>;
  model: InsightsChatModel;
  reasoningEffort: OpenAIReasoningEffort;
}): Promise<{ synthesis: InsightContextPackSynthesis; interactionId: string | null }> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const leadIds = Array.from(new Set(opts.threads.map((t) => t.leadId)));
  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      emailCampaign: { select: { id: true, name: true } },
    },
  });
  const leadMetaById = new Map(leads.map((l) => [l.id, l]));

  const grouped = new Map<
    string,
    { campaignId: string | null; campaignName: string | null; items: typeof opts.threads }
  >();
  for (const thread of opts.threads) {
    const meta = leadMetaById.get(thread.leadId);
    const campaignId = meta?.emailCampaign?.id ?? null;
    const campaignName = meta?.emailCampaign?.name ?? null;
    const key = campaignId ?? "workspace";
    const existing = grouped.get(key);
    if (existing) {
      existing.items.push(thread);
    } else {
      grouped.set(key, { campaignId, campaignName, items: [thread] });
    }
  }

  const campaignsCount = grouped.size;
  const shouldMapReduce = campaignsCount > 1 || opts.threads.length > 120;

  // Use v2 prompts with follow-up weighting (Phase 29d)
  const packPrompt = getAIPromptTemplate("insights.pack_synthesize.v2");
  const campaignPrompt = getAIPromptTemplate("insights.pack_campaign_summarize.v2");
  const packSystem =
    packPrompt?.messages.find((m) => m.role === "system")?.content ||
    "Return ONLY valid JSON with keys: pack_markdown, key_takeaways, recommended_experiments, data_gaps.";
  const campaignSystem =
    campaignPrompt?.messages.find((m) => m.role === "system")?.content ||
    "Return ONLY valid JSON with keys: campaign_overview, what_worked, what_failed, recommended_experiments, notable_examples.";

  const timeoutMs = Math.max(8_000, Number.parseInt(process.env.OPENAI_INSIGHTS_PACK_TIMEOUT_MS || "90000", 10) || 90_000);

  try {
    if (shouldMapReduce) {
      const campaignSummaries: Array<{
        campaignId: string | null;
        campaignName: string | null;
        summary: CampaignInsightSummary;
      }> = [];

      for (const group of grouped.values()) {
        const compact = group.items.map((t) => {
          const meta = leadMetaById.get(t.leadId);
          return {
            leadId: t.leadId,
            lead: meta ? formatLeadLabel(meta) : t.leadId,
            outcome: t.outcome,
            insight: compactInsight(t.insight),
          };
        });

        const campaignInput = JSON.stringify(
          {
            seed_question: opts.seedQuestion,
            window: opts.windowLabel,
            campaign: group.campaignId ? { id: group.campaignId, name: group.campaignName } : null,
            analytics_snapshot: opts.analyticsSnapshot ?? null,
            threads: compact,
          },
          null,
          2
        );

        const budget = await computeAdaptiveMaxOutputTokens({
          model: opts.model,
          instructions: campaignSystem,
          input: [{ role: "user", content: campaignInput }],
          min: 700,
          max: 2200,
          overheadTokens: 420,
          outputScale: 0.22,
          preferApiCount: true,
        });

        const { parsed } = await runStructuredJson<CampaignInsightSummary>({
          clientId: opts.clientId,
          featureId: campaignPrompt?.featureId || "insights.pack_campaign_summarize",
          promptKey: campaignPrompt?.key || "insights.pack_campaign_summarize.v1",
          model: opts.model,
          reasoningEffort: opts.reasoningEffort,
          instructions: campaignSystem,
          input: [{ role: "user", content: campaignInput }],
          jsonSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
              campaign_overview: { type: "string" },
              what_worked: { type: "array", items: { type: "string" } },
              what_failed: { type: "array", items: { type: "string" } },
              recommended_experiments: { type: "array", items: { type: "string" } },
              notable_examples: { type: "array", items: { type: "string" } },
            },
            required: ["campaign_overview", "what_worked", "what_failed", "recommended_experiments", "notable_examples"],
          },
          maxOutputTokens: budget.maxOutputTokens,
          timeoutMs,
        });

        const validated = CampaignSummarySchema.safeParse(parsed);
        if (!validated.success) throw new Error(`Campaign summary schema mismatch: ${validated.error.message}`);

        campaignSummaries.push({
          campaignId: group.campaignId,
          campaignName: group.campaignName,
          summary: validated.data,
        });
      }

      const packInput = JSON.stringify(
        {
          seed_question: opts.seedQuestion,
          window: opts.windowLabel,
          campaign_ids: opts.campaignIds,
          analytics_snapshot: opts.analyticsSnapshot ?? null,
          campaign_summaries: campaignSummaries,
        },
        null,
        2
      );

      const budget = await computeAdaptiveMaxOutputTokens({
        model: opts.model,
        instructions: packSystem,
        input: [{ role: "user", content: packInput }],
        min: 1200,
        max: 5200,
        overheadTokens: 650,
        outputScale: 0.25,
        preferApiCount: true,
      });

      const attempts = [budget.maxOutputTokens, Math.min(budget.maxOutputTokens + 1200, 7200)];
      let lastInteractionId: string | null = null;
      let lastErr: string | null = null;

      for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
        try {
          const { parsed, interactionId } = await runStructuredJson<InsightContextPackSynthesis>({
            clientId: opts.clientId,
            featureId: packPrompt?.featureId || "insights.pack_synthesize",
            promptKey: (packPrompt?.key || "insights.pack_synthesize.v1") + (attemptIndex === 0 ? "" : `.retry${attemptIndex + 1}`),
            model: opts.model,
            reasoningEffort: opts.reasoningEffort,
            instructions: packSystem,
            input: [{ role: "user", content: packInput }],
            jsonSchema: {
              type: "object",
              additionalProperties: false,
              properties: {
                pack_markdown: { type: "string" },
                key_takeaways: { type: "array", items: { type: "string" } },
                recommended_experiments: { type: "array", items: { type: "string" } },
                data_gaps: { type: "array", items: { type: "string" } },
              },
              required: ["pack_markdown", "key_takeaways", "recommended_experiments", "data_gaps"],
            },
            maxOutputTokens: attempts[attemptIndex],
            timeoutMs,
          });

          lastInteractionId = interactionId;
          const validated = PackSynthesisSchema.safeParse(parsed);
          if (!validated.success) throw new Error(`Pack synthesis schema mismatch: ${validated.error.message}`);
          return { synthesis: validated.data, interactionId };
        } catch (error) {
          lastErr = error instanceof Error ? error.message : "Unknown error";
          if (attemptIndex < attempts.length - 1) continue;
        }
      }

      if (lastInteractionId && lastErr) await markAiInteractionError(lastInteractionId, lastErr);
      throw new Error(lastErr || "Failed to synthesize context pack");
    }

    // Small pack: synthesize directly from threads.
    const compactThreads = opts.threads.map((t) => {
      const meta = leadMetaById.get(t.leadId);
      return {
        leadId: t.leadId,
        lead: meta ? formatLeadLabel(meta) : t.leadId,
        outcome: t.outcome,
        insight: compactInsight(t.insight),
      };
    });

    const packInput = JSON.stringify(
      {
        seed_question: opts.seedQuestion,
        window: opts.windowLabel,
        campaign_ids: opts.campaignIds,
        analytics_snapshot: opts.analyticsSnapshot ?? null,
        threads: compactThreads,
      },
      null,
      2
    );

    const budget = await computeAdaptiveMaxOutputTokens({
      model: opts.model,
      instructions: packSystem,
      input: [{ role: "user", content: packInput }],
      min: 1400,
      max: 6000,
      overheadTokens: 650,
      outputScale: 0.25,
      preferApiCount: true,
    });

    const { parsed, interactionId } = await runStructuredJson<InsightContextPackSynthesis>({
      clientId: opts.clientId,
      featureId: packPrompt?.featureId || "insights.pack_synthesize",
      promptKey: packPrompt?.key || "insights.pack_synthesize.v1",
      model: opts.model,
      reasoningEffort: opts.reasoningEffort,
      instructions: packSystem,
      input: [{ role: "user", content: packInput }],
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          pack_markdown: { type: "string" },
          key_takeaways: { type: "array", items: { type: "string" } },
          recommended_experiments: { type: "array", items: { type: "string" } },
          data_gaps: { type: "array", items: { type: "string" } },
        },
        required: ["pack_markdown", "key_takeaways", "recommended_experiments", "data_gaps"],
      },
      maxOutputTokens: budget.maxOutputTokens,
      timeoutMs,
    });

    const validated = PackSynthesisSchema.safeParse(parsed);
    if (!validated.success) throw new Error(`Pack synthesis schema mismatch: ${validated.error.message}`);
    return { synthesis: validated.data, interactionId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(message);
  }
}
