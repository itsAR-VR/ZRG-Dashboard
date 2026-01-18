import "server-only";

import "@/lib/server-dns";
import { prisma } from "@/lib/prisma";
import { selectThreadsForInsightPack, type InsightCampaignScope } from "@/lib/insights-chat/thread-selection";
import { extractConversationInsightForLead, CONVERSATION_INSIGHT_SCHEMA_VERSION, type ConversationInsight } from "@/lib/insights-chat/thread-extractor";
import { synthesizeInsightContextPack } from "@/lib/insights-chat/pack-synthesis";
import { answerInsightsChatQuestion } from "@/lib/insights-chat/chat-answer";
import { buildInsightThreadIndex } from "@/lib/insights-chat/thread-index";
import { coerceInsightsChatModel, coerceInsightsChatReasoningEffort } from "@/lib/insights-chat/config";
import { formatInsightsWindowLabel } from "@/lib/insights-chat/window";
import {
  buildFastContextPackMarkdown,
  computeFollowUpPriorityScore,
  getFastSeedMaxThreads,
  getFastSeedMinThreads,
  selectFastSeedThreads,
} from "@/lib/insights-chat/fast-seed";
import { formatOpenAiErrorSummary, isRetryableOpenAiError } from "@/lib/ai/openai-error-utils";
import { Prisma } from "@prisma/client";
import type { ConversationInsightOutcome, InsightContextPackStatus } from "@prisma/client";
import type { InsightThreadIndexItem } from "@/lib/insights-chat/citations";
import type { SelectedInsightThread } from "@/lib/insights-chat/thread-selection";

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function coerceSelectedInsightThreadsMeta(value: unknown): SelectedInsightThread[] {
  const meta = Array.isArray(value) ? (value as any[]) : [];
  return meta
    .map((row) => {
      const leadId = typeof row?.leadId === "string" ? row.leadId : null;
      if (!leadId) return null;
      const outcome = typeof row?.outcome === "string" ? row.outcome : null;
      const exampleType = row?.exampleType === "positive" || row?.exampleType === "negative" ? row.exampleType : null;
      const selectionBucket = typeof row?.selectionBucket === "string" ? row.selectionBucket : null;
      return {
        leadId,
        emailCampaignId: typeof row?.emailCampaignId === "string" ? row.emailCampaignId : null,
        outcome: (outcome || "UNKNOWN") as any,
        exampleType: (exampleType || "positive") as any,
        selectionBucket: (selectionBucket || "unknown") as any,
      };
    })
    .filter(Boolean) as SelectedInsightThread[];
}

async function mapWithConcurrencySettled<TItem, TResult>(
  items: TItem[],
  concurrency: number,
  fn: (item: TItem, index: number) => Promise<TResult>
): Promise<Array<PromiseSettledResult<TResult>>> {
  if (items.length === 0) return [];
  const results = new Array<PromiseSettledResult<TResult>>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) break;
      try {
        const value = await fn(items[currentIndex]!, currentIndex);
        results[currentIndex] = { status: "fulfilled", value };
      } catch (reason) {
        results[currentIndex] = { status: "rejected", reason };
      }
    }
  });

  await Promise.all(workers);
  return results;
}

function getLeadExtractionConcurrency(batchSize: number): number {
  const parsed = Number.parseInt(process.env.INSIGHTS_CONTEXT_PACK_LEAD_CONCURRENCY || "", 10);
  if (Number.isFinite(parsed) && parsed > 0) return clampInt(parsed, 1, 25);
  return clampInt(Math.min(8, batchSize), 1, 25);
}

export type ContextPackWorkerStepResult = {
  clientId: string;
  sessionId: string;
  contextPackId: string;
  status: InsightContextPackStatus;
  processedThreads: number;
  targetThreadsTotal: number;
};

const OUTCOME_PRIORITY: Record<ConversationInsightOutcome, number> = {
  BOOKED: 0,
  REQUESTED: 1,
  STALLED: 2,
  NO_RESPONSE: 3,
  UNKNOWN: 4,
};

async function loadPackForWork(contextPackId: string) {
  return prisma.insightContextPack.findUnique({
    where: { id: contextPackId },
    select: {
      id: true,
      clientId: true,
      sessionId: true,
      status: true,
      windowPreset: true,
      allCampaigns: true,
      campaignCap: true,
      windowFrom: true,
      windowTo: true,
      selectedCampaignIds: true,
      effectiveCampaignIds: true,
      targetThreadsTotal: true,
      processedThreads: true,
      selectedLeadIds: true,
      processedLeadIds: true,
      selectedLeadsMeta: true,
      metricsSnapshot: true,
      synthesis: true,
      model: true,
      reasoningEffort: true,
      lastError: true,
      computedAt: true,
      computedByUserId: true,
      computedByEmail: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
      seedAssistantMessageId: true,
      session: { select: { deletedAt: true, seedQuestion: true } },
    },
  });
}

export async function runInsightContextPackStepSystem(opts: {
  contextPackId: string;
  maxThreadsToProcess?: number;
}): Promise<ContextPackWorkerStepResult | null> {
  const pack = await loadPackForWork(opts.contextPackId);
  if (!pack) return null;
  if (pack.deletedAt) return null;
  if (pack.session.deletedAt) return null;

  if (pack.status === "COMPLETE" || pack.status === "FAILED") {
    return {
      clientId: pack.clientId,
      sessionId: pack.sessionId,
      contextPackId: pack.id,
      status: pack.status,
      processedThreads: pack.processedThreads,
      targetThreadsTotal: pack.targetThreadsTotal,
    };
  }

  const model = coerceInsightsChatModel(pack.model);
  const effort = coerceInsightsChatReasoningEffort({ model, storedValue: pack.reasoningEffort });

  const isUninitialized = pack.targetThreadsTotal === 0 || pack.selectedLeadIds.length === 0;
  if (isUninitialized) {
    const campaignScope: InsightCampaignScope = pack.allCampaigns
      ? { mode: "all", cap: pack.campaignCap ?? 10 }
      : pack.selectedCampaignIds.length
        ? { mode: "selected", campaignIds: pack.selectedCampaignIds }
        : { mode: "workspace" };

    const selection = await selectThreadsForInsightPack({
      clientId: pack.clientId,
      from: pack.windowFrom,
      to: pack.windowTo,
      campaignScope,
    });

    if (selection.threads.length === 0) {
      const updated = await prisma.insightContextPack.update({
        where: { id: pack.id },
        data: { status: "FAILED", lastError: "No threads found for this window/campaign scope." },
        select: { status: true, processedThreads: true, targetThreadsTotal: true },
      });
      return {
        clientId: pack.clientId,
        sessionId: pack.sessionId,
        contextPackId: pack.id,
        status: updated.status,
        processedThreads: updated.processedThreads,
        targetThreadsTotal: updated.targetThreadsTotal,
      };
    }

    const updated = await prisma.insightContextPack.update({
      where: { id: pack.id },
      data: {
        status: "RUNNING",
        effectiveCampaignIds: selection.campaignIds,
        targetThreadsTotal: selection.threads.length,
        processedThreads: 0,
        selectedLeadIds: selection.threads.map((t) => t.leadId),
        processedLeadIds: [],
        selectedLeadsMeta: selection.threads as any,
        // If the pack was created from a cron worker, we may not have an auth context
        // to compute full analytics snapshots. Keep whatever is already stored.
        metricsSnapshot: pack.metricsSnapshot as any,
        synthesis: Prisma.DbNull,
        lastError: null,
        computedAt: null,
      },
      select: { status: true, processedThreads: true, targetThreadsTotal: true },
    });

    return {
      clientId: pack.clientId,
      sessionId: pack.sessionId,
      contextPackId: pack.id,
      status: updated.status,
      processedThreads: updated.processedThreads,
      targetThreadsTotal: updated.targetThreadsTotal,
    };
  }

  if (pack.processedLeadIds.length < pack.selectedLeadIds.length) {
    const selectedMeta = Array.isArray(pack.selectedLeadsMeta) ? (pack.selectedLeadsMeta as any[]) : [];
    const outcomeByLeadId = new Map<string, ConversationInsightOutcome>();
    for (const row of selectedMeta) {
      const leadId = typeof row?.leadId === "string" ? row.leadId : null;
      const outcome = typeof row?.outcome === "string" ? row.outcome : null;
      if (leadId && outcome) outcomeByLeadId.set(leadId, outcome as ConversationInsightOutcome);
    }

    const processed = new Set(pack.processedLeadIds);
    const remaining = pack.selectedLeadIds.filter((id) => !processed.has(id));
    const batchSize = clampInt(Number(opts.maxThreadsToProcess ?? 1) || 1, 1, 25);
    const batch = remaining.slice(0, batchSize);
    const concurrency = getLeadExtractionConcurrency(batch.length);

    const results = await mapWithConcurrencySettled(batch, concurrency, async (leadId) => {
        const outcome = outcomeByLeadId.get(leadId) ?? "UNKNOWN";

        // Check for existing insight and schema version (Phase 29e)
        const existing = await prisma.leadConversationInsight.findUnique({
          where: { leadId },
          select: { id: true, insight: true },
        });

        if (existing) {
          // Schema upgrade check: if existing insight has old schema, consider re-extraction
          const insightJson = existing.insight as { schema_version?: string } | null;
          const currentVersion = insightJson?.schema_version;
          const needsUpgrade = currentVersion !== CONVERSATION_INSIGHT_SCHEMA_VERSION;
          const allowUpgrade = process.env.INSIGHTS_ALLOW_SCHEMA_UPGRADE_REEXTRACT === "true";

          // Skip if already up-to-date OR upgrades not allowed
          if (!needsUpgrade || !allowUpgrade) {
            return { leadId, ok: true } as const;
          }
          // Fall through to re-extract with new schema
        }

        const extracted = await extractConversationInsightForLead({
          clientId: pack.clientId,
          leadId,
          outcome,
          model,
          reasoningEffort: effort.api,
        });

        await prisma.leadConversationInsight.upsert({
          where: { leadId },
          create: {
            leadId,
            outcome,
            insight: extracted.insight as any,
            model,
            reasoningEffort: effort.stored,
            source: "chat_pack",
            computedAt: new Date(),
            computedByUserId: pack.computedByUserId ?? null,
            computedByEmail: pack.computedByEmail ?? null,
          },
          update: {
            outcome,
            insight: extracted.insight as any,
            model,
            reasoningEffort: effort.stored,
            source: "chat_pack",
            computedAt: new Date(),
            computedByUserId: pack.computedByUserId ?? null,
            computedByEmail: pack.computedByEmail ?? null,
          },
        });

        return { leadId, ok: true } as const;
      });

    const nextProcessedLeadIds = Array.from(new Set([...pack.processedLeadIds, ...batch]));
    const nextMeta = selectedMeta.map((row) => {
      const leadId = typeof row?.leadId === "string" ? row.leadId : null;
      if (!leadId) return row;
      if (!batch.includes(leadId)) return row;
      const res = results[batch.indexOf(leadId)];
      if (res && res.status === "rejected") {
        return { ...row, processed: true, error: res.reason instanceof Error ? res.reason.message : String(res.reason) };
      }
      return { ...row, processed: true };
    });

    const updated = await prisma.insightContextPack.update({
      where: { id: pack.id },
      data: {
        status: "RUNNING",
        processedLeadIds: nextProcessedLeadIds,
        processedThreads: nextProcessedLeadIds.length,
        selectedLeadsMeta: nextMeta as any,
      },
      select: { status: true, processedThreads: true, targetThreadsTotal: true },
    });

    // Fast seed answer: once enough threads are processed, create an early answer
    // so the user gets value quickly while the pack continues building.
    try {
      if (!pack.seedAssistantMessageId) {
        const minThreads = getFastSeedMinThreads(pack.targetThreadsTotal);
        if (nextProcessedLeadIds.length >= minThreads) {
          const seedQuestion = (pack.session.seedQuestion || "").trim();
          if (seedQuestion) {
            const insights = await prisma.leadConversationInsight.findMany({
              where: { leadId: { in: nextProcessedLeadIds } },
              select: { leadId: true, insight: true },
            });
            const insightByLeadId = new Map<string, ConversationInsight>();
            for (const row of insights) insightByLeadId.set(row.leadId, row.insight as any as ConversationInsight);

            const threads = selectFastSeedThreads({
              processedLeadIds: nextProcessedLeadIds,
              selectedLeadsMeta: nextMeta,
              insightByLeadId,
              maxThreads: Math.min(getFastSeedMaxThreads(), nextProcessedLeadIds.length),
            });

            if (threads.length >= 5) {
              const windowLabel = formatInsightsWindowLabel({
                preset: pack.windowPreset,
                from: pack.windowFrom,
                to: pack.windowTo,
              });
              const campaignLabel = pack.allCampaigns
                ? `All campaigns (cap ${pack.campaignCap ?? 10})`
                : pack.effectiveCampaignIds.length
                  ? `Selected campaigns (${pack.effectiveCampaignIds.length})`
                  : "Workspace (no campaign filter)";

              const fastPackMarkdown = buildFastContextPackMarkdown({
                windowLabel,
                campaignContextLabel: campaignLabel,
                processedThreads: nextProcessedLeadIds.length,
                targetThreadsTotal: pack.targetThreadsTotal,
                threads,
              });

              const fastThreadIndex: InsightThreadIndexItem[] = threads.map((t, idx) => ({
                ref: `T${String(idx + 1).padStart(3, "0")}`,
                leadId: t.leadId,
                outcome: t.outcome,
                exampleType: "positive",
                selectionBucket: "fast_seed",
                emailCampaignId: null,
                campaignName: null,
                leadLabel: `lead ${t.leadId}`,
                summary: String(t.insight.summary || "").trim().slice(0, 380) || "No extracted summary available.",
              }));

              const answer = await answerInsightsChatQuestion({
                clientId: pack.clientId,
                sessionId: pack.sessionId,
                question: seedQuestion,
                windowLabel,
                campaignContextLabel: campaignLabel,
                analyticsSnapshot: pack.metricsSnapshot,
                contextPackMarkdown: fastPackMarkdown,
                threadIndex: fastThreadIndex,
                recentMessages: [],
                model,
                reasoningEffort: effort.api,
              });

              const assistantMessage = await prisma.insightChatMessage.create({
                data: {
                  clientId: pack.clientId,
                  sessionId: pack.sessionId,
                  role: "ASSISTANT",
                  content: `**Fast answer (partial pack)**\n\n${answer.answer}`.trim(),
                  citations: answer.citations as any,
                  authorUserId: null,
                  authorEmail: null,
                  contextPackId: pack.id,
                },
                select: { id: true },
              });

              await prisma.insightContextPack.update({
                where: { id: pack.id },
                data: { seedAssistantMessageId: assistantMessage.id },
              });
            }
          }
        }
      }
    } catch (error) {
      // Best-effort; do not fail the worker step if fast-answer generation fails.
      console.warn("[Insights Worker] Fast seed answer generation failed:", error);
    }

    return {
      clientId: pack.clientId,
      sessionId: pack.sessionId,
      contextPackId: pack.id,
      status: updated.status,
      processedThreads: updated.processedThreads,
      targetThreadsTotal: updated.targetThreadsTotal,
    };
  }

  if (pack.synthesis) {
    const updated = await prisma.insightContextPack.update({
      where: { id: pack.id },
      data: { status: "COMPLETE" },
      select: { status: true, processedThreads: true, targetThreadsTotal: true },
    });
    return {
      clientId: pack.clientId,
      sessionId: pack.sessionId,
      contextPackId: pack.id,
      status: updated.status,
      processedThreads: updated.processedThreads,
      targetThreadsTotal: updated.targetThreadsTotal,
    };
  }

  const seedQuestion = (pack.session.seedQuestion || "").trim();
  if (!seedQuestion) {
    const updated = await prisma.insightContextPack.update({
      where: { id: pack.id },
      data: { status: "FAILED", lastError: "Missing seed question for this session." },
      select: { status: true, processedThreads: true, targetThreadsTotal: true },
    });
    return {
      clientId: pack.clientId,
      sessionId: pack.sessionId,
      contextPackId: pack.id,
      status: updated.status,
      processedThreads: updated.processedThreads,
      targetThreadsTotal: updated.targetThreadsTotal,
    };
  }

  const insights = await prisma.leadConversationInsight.findMany({
    where: { leadId: { in: pack.selectedLeadIds } },
    select: { leadId: true, insight: true },
  });
  const insightByLeadId = new Map<string, ConversationInsight>();
  for (const row of insights) {
    insightByLeadId.set(row.leadId, row.insight as any as ConversationInsight);
  }

  const selectedMeta = Array.isArray(pack.selectedLeadsMeta) ? (pack.selectedLeadsMeta as any[]) : [];
  const outcomeByLeadId = new Map<string, ConversationInsightOutcome>();
  for (const row of selectedMeta) {
    const leadId = typeof row?.leadId === "string" ? row.leadId : null;
    const outcome = typeof row?.outcome === "string" ? row.outcome : null;
    if (leadId && outcome) outcomeByLeadId.set(leadId, outcome as ConversationInsightOutcome);
  }

  const threadsForSynthesis = pack.selectedLeadIds
    .map((leadId) => {
      const insight = insightByLeadId.get(leadId);
      if (!insight) return null;
      return { leadId, outcome: outcomeByLeadId.get(leadId) ?? "UNKNOWN", insight };
    })
    .filter(Boolean) as Array<{ leadId: string; outcome: ConversationInsightOutcome; insight: ConversationInsight }>;

  // Phase 29c: ensure highest-signal follow-up threads are seen first by the synthesizer.
  threadsForSynthesis.sort((a, b) => {
    const followUpA = computeFollowUpPriorityScore(a.insight.follow_up_effectiveness);
    const followUpB = computeFollowUpPriorityScore(b.insight.follow_up_effectiveness);
    if (followUpA !== followUpB) return followUpB - followUpA;
    return (OUTCOME_PRIORITY[a.outcome] ?? 99) - (OUTCOME_PRIORITY[b.outcome] ?? 99);
  });

  const windowLabel = formatInsightsWindowLabel({
    preset: pack.windowPreset,
    from: pack.windowFrom,
    to: pack.windowTo,
  });

  try {
    const synthesis = await synthesizeInsightContextPack({
      clientId: pack.clientId,
      seedQuestion,
      windowLabel,
      campaignIds: pack.effectiveCampaignIds,
      analyticsSnapshot: pack.metricsSnapshot,
      threads: threadsForSynthesis,
      model,
      reasoningEffort: effort.api,
    });

    const updated = await prisma.insightContextPack.update({
      where: { id: pack.id },
      data: {
        status: "COMPLETE",
        synthesis: synthesis.synthesis as any,
        computedAt: new Date(),
        lastError: null,
      },
      select: { status: true, processedThreads: true, targetThreadsTotal: true },
    });

    return {
      clientId: pack.clientId,
      sessionId: pack.sessionId,
      contextPackId: pack.id,
      status: updated.status,
      processedThreads: updated.processedThreads,
      targetThreadsTotal: updated.targetThreadsTotal,
    };
  } catch (error) {
    const msg = formatOpenAiErrorSummary(error);
    const status: InsightContextPackStatus = isRetryableOpenAiError(error) ? "RUNNING" : "FAILED";
    const updated = await prisma.insightContextPack.update({
      where: { id: pack.id },
      data: { status, lastError: msg },
      select: { status: true, processedThreads: true, targetThreadsTotal: true },
    });
    return {
      clientId: pack.clientId,
      sessionId: pack.sessionId,
      contextPackId: pack.id,
      status: updated.status,
      processedThreads: updated.processedThreads,
      targetThreadsTotal: updated.targetThreadsTotal,
    };
  }
}

export async function ensureSeedAnswerSystem(opts: {
  contextPackId: string;
  force?: boolean;
}): Promise<{ created: boolean; assistantMessageId?: string }> {
  const force = Boolean(opts.force);
  const pack = await loadPackForWork(opts.contextPackId);
  if (!pack) return { created: false };
  if (pack.deletedAt || pack.session.deletedAt) return { created: false };

  const synthesisObj = pack.synthesis as any;
  const packMarkdown = typeof synthesisObj?.pack_markdown === "string" ? synthesisObj.pack_markdown : null;
  if (pack.status !== "COMPLETE" || !packMarkdown) return { created: false };

  const latestCompute = await prisma.insightChatAuditEvent.findFirst({
    where: { clientId: pack.clientId, contextPackId: pack.id, action: { in: ["CONTEXT_PACK_CREATED", "CONTEXT_PACK_RECOMPUTED"] } },
    select: { action: true },
    orderBy: { createdAt: "desc" },
  });

  const hasAssistant = await prisma.insightChatMessage.findFirst({
    where: { clientId: pack.clientId, sessionId: pack.sessionId, role: "ASSISTANT" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  // For recomputes, do not auto-generate a new answer if the session already has an assistant response.
  if (!force && latestCompute?.action === "CONTEXT_PACK_RECOMPUTED" && hasAssistant) return { created: false };

  const currentSeedMessage = pack.seedAssistantMessageId
    ? await prisma.insightChatMessage.findUnique({
        where: { id: pack.seedAssistantMessageId },
        select: { id: true, createdAt: true, sessionId: true },
      })
    : null;

  // If we already have a seed answer created after the final pack computedAt, nothing to do.
  if (
    !force &&
    currentSeedMessage &&
    currentSeedMessage.sessionId === pack.sessionId &&
    pack.computedAt &&
    currentSeedMessage.createdAt >= pack.computedAt
  ) {
    return { created: false };
  }

  // If there is any assistant message and no seed pointer, avoid creating duplicates (unless forced).
  if (!force && !pack.seedAssistantMessageId && hasAssistant) return { created: false };

  const seedQuestion =
    (pack.session.seedQuestion || "").trim() ||
    (
      await prisma.insightChatMessage.findFirst({
        where: { clientId: pack.clientId, sessionId: pack.sessionId, role: "USER" },
        select: { content: true },
        orderBy: { createdAt: "asc" },
      })
    )?.content ||
    null;

  if (!seedQuestion?.trim()) return { created: false };

  const model = coerceInsightsChatModel(pack.model);
  const effort = coerceInsightsChatReasoningEffort({ model, storedValue: pack.reasoningEffort });
  const windowLabel = formatInsightsWindowLabel({
    preset: pack.windowPreset,
    from: pack.windowFrom,
    to: pack.windowTo,
  });
  const campaignLabel = pack.allCampaigns
    ? `All campaigns (cap ${pack.campaignCap ?? 10})`
    : pack.effectiveCampaignIds.length
      ? `Selected campaigns (${pack.effectiveCampaignIds.length})`
      : "Workspace (no campaign filter)";

  try {
    const cleanedMeta = coerceSelectedInsightThreadsMeta(pack.selectedLeadsMeta);
    const threadIndex = await buildInsightThreadIndex({ clientId: pack.clientId, selectedMeta: cleanedMeta });

    const answer = await answerInsightsChatQuestion({
      clientId: pack.clientId,
      sessionId: pack.sessionId,
      question: seedQuestion,
      windowLabel,
      campaignContextLabel: campaignLabel,
      analyticsSnapshot: pack.metricsSnapshot,
      contextPackMarkdown: packMarkdown,
      threadIndex,
      recentMessages: [],
      model,
      reasoningEffort: effort.api,
    });

    const assistantMessage = await prisma.insightChatMessage.create({
      data: {
        clientId: pack.clientId,
        sessionId: pack.sessionId,
        role: "ASSISTANT",
        content: `${currentSeedMessage ? "**Full answer (pack complete)**\n\n" : ""}${answer.answer}`.trim(),
        citations: answer.citations as any,
        authorUserId: null,
        authorEmail: null,
        contextPackId: pack.id,
      },
      select: { id: true },
    });

    await prisma.insightContextPack.update({
      where: { id: pack.id },
      data: { seedAssistantMessageId: assistantMessage.id, lastError: null },
    });

    return { created: true, assistantMessageId: assistantMessage.id };
  } catch (error) {
    const msg = formatOpenAiErrorSummary(error);
    console.warn("[Insights Worker] Seed answer generation failed:", msg);

    try {
      await prisma.insightContextPack.update({
        where: { id: pack.id },
        data: { lastError: msg.slice(0, 10_000) },
      });
    } catch (dbError) {
      console.warn("[Insights Worker] Failed to store seed-answer error:", dbError);
    }

    // Best-effort: cron will retry on the next run.
    return { created: false };
  }
}
