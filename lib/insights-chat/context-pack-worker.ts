import "server-only";

import "@/lib/server-dns";
import { prisma } from "@/lib/prisma";
import { selectThreadsForInsightPack, type InsightCampaignScope } from "@/lib/insights-chat/thread-selection";
import { extractConversationInsightForLead, type ConversationInsight } from "@/lib/insights-chat/thread-extractor";
import { synthesizeInsightContextPack } from "@/lib/insights-chat/pack-synthesis";
import { answerInsightsChatQuestion } from "@/lib/insights-chat/chat-answer";
import { coerceInsightsChatModel, coerceInsightsChatReasoningEffort } from "@/lib/insights-chat/config";
import { formatInsightsWindowLabel } from "@/lib/insights-chat/window";
import type { ConversationInsightOutcome, InsightContextPackStatus } from "@prisma/client";

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export type ContextPackWorkerStepResult = {
  clientId: string;
  sessionId: string;
  contextPackId: string;
  status: InsightContextPackStatus;
  processedThreads: number;
  targetThreadsTotal: number;
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
        synthesis: null,
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
    const batchSize = clampInt(Number(opts.maxThreadsToProcess ?? 1) || 1, 1, 10);
    const batch = remaining.slice(0, batchSize);

    const results = await Promise.allSettled(
      batch.map(async (leadId) => {
        const outcome = outcomeByLeadId.get(leadId) ?? "UNKNOWN";

        const existing = await prisma.leadConversationInsight.findUnique({
          where: { leadId },
          select: { id: true },
        });
        if (existing) return { leadId, ok: true } as const;

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
      })
    );

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
    const msg = error instanceof Error ? error.message : "Failed to synthesize context pack";
    const updated = await prisma.insightContextPack.update({
      where: { id: pack.id },
      data: { status: "FAILED", lastError: msg },
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

  if (!force && pack.seedAssistantMessageId) return { created: false };

  if (!force) {
    const existingAssistant = await prisma.insightChatMessage.findFirst({
      where: { clientId: pack.clientId, sessionId: pack.sessionId, role: "ASSISTANT" },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (existingAssistant) return { created: false };
  }

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

  const answer = await answerInsightsChatQuestion({
    clientId: pack.clientId,
    sessionId: pack.sessionId,
    question: seedQuestion,
    windowLabel,
    campaignContextLabel: campaignLabel,
    analyticsSnapshot: pack.metricsSnapshot,
    contextPackMarkdown: packMarkdown,
    recentMessages: [],
    model,
    reasoningEffort: effort.api,
  });

  const assistantMessage = await prisma.insightChatMessage.create({
    data: {
      clientId: pack.clientId,
      sessionId: pack.sessionId,
      role: "ASSISTANT",
      content: answer.answer,
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

  return { created: true, assistantMessageId: assistantMessage.id };
}

