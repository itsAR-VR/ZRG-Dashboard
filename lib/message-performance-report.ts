import "server-only";

import { prisma } from "@/lib/prisma";
import { buildMessagePerformanceDataset, type MessagePerformanceRunResult } from "@/lib/message-performance";
import { buildMessagePerformanceEvidenceSample } from "@/lib/message-performance-evidence";
import { synthesizeMessagePerformance, type MessagePerformanceSynthesis } from "@/lib/message-performance-synthesis";

export const MESSAGE_PERFORMANCE_SESSION_TITLE = "Message Performance";

function buildScopeKey(windowFrom: Date, windowTo: Date): string {
  return `message_performance:${windowFrom.toISOString()}:${windowTo.toISOString()}`;
}

export async function ensureMessagePerformanceSession(clientId: string, createdByUserId: string | null, createdByEmail: string | null) {
  const existing = await prisma.insightChatSession.findFirst({
    where: { clientId, title: MESSAGE_PERFORMANCE_SESSION_TITLE, deletedAt: null },
    select: { id: true },
  });
  if (existing) return existing.id;

  const fallbackUserId: string = createdByUserId ?? "system";
  const session = await prisma.insightChatSession.create({
    data: {
      clientId,
      title: MESSAGE_PERFORMANCE_SESSION_TITLE,
      createdByUserId: fallbackUserId,
      createdByEmail: createdByEmail || null,
    },
    select: { id: true },
  });
  return session.id;
}

export async function upsertMessagePerformancePack(opts: {
  clientId: string;
  windowFrom: Date;
  windowTo: Date;
  computedByUserId: string | null;
  computedByEmail: string | null;
  result: MessagePerformanceRunResult;
  synthesis: MessagePerformanceSynthesis | null;
}) {
  const sessionId = await ensureMessagePerformanceSession(opts.clientId, opts.computedByUserId, opts.computedByEmail);
  const scopeKey = buildScopeKey(opts.windowFrom, opts.windowTo);

  const metricsSnapshot = {
    metrics: opts.result.metrics,
    stats: opts.result.stats,
    rows: opts.result.rows,
  };

  const synthesis = opts.synthesis
    ? opts.synthesis
    : {
        summary: "Message Performance metrics computed.",
        highlights: [],
        patterns: [],
        antiPatterns: [],
        recommendations: [],
        caveats: [],
        confidence: 0.3,
      };

  const pack = await prisma.insightContextPack.upsert({
    where: { sessionId_scopeKey: { sessionId, scopeKey } },
    create: {
      clientId: opts.clientId,
      sessionId,
      scopeKey,
      status: "COMPLETE",
      allCampaigns: true,
      windowPreset: "CUSTOM",
      windowFrom: opts.windowFrom,
      windowTo: opts.windowTo,
      targetThreadsTotal: 0,
      processedThreads: 0,
      selectedLeadIds: Array.from(new Set(opts.result.rows.map((r) => r.leadId))),
      processedLeadIds: [],
      metricsSnapshot: metricsSnapshot as any,
      synthesis: synthesis as any,
      model: "metrics-only",
      reasoningEffort: "none",
      computedAt: new Date(),
      computedByUserId: opts.computedByUserId,
      computedByEmail: opts.computedByEmail,
    },
    update: {
      status: "COMPLETE",
      windowFrom: opts.windowFrom,
      windowTo: opts.windowTo,
      metricsSnapshot: metricsSnapshot as any,
      synthesis: synthesis as any,
      computedAt: new Date(),
      computedByUserId: opts.computedByUserId,
      computedByEmail: opts.computedByEmail,
    },
    select: { id: true },
  });

  return pack.id;
}

export async function runMessagePerformanceReportSystem(opts: {
  clientId: string;
  windowFrom: Date;
  windowTo: Date;
  attributionWindowDays?: number;
  maturityBufferDays?: number;
  includeSynthesis?: boolean;
  synthesisMaxPerBucket?: number;
  computedByUserId?: string | null;
  computedByEmail?: string | null;
}): Promise<{
  packId: string;
  result: MessagePerformanceRunResult;
  synthesis: MessagePerformanceSynthesis | null;
}> {
  const result = await buildMessagePerformanceDataset({
    clientId: opts.clientId,
    windowFrom: opts.windowFrom,
    windowTo: opts.windowTo,
    attributionWindowDays: opts.attributionWindowDays,
    maturityBufferDays: opts.maturityBufferDays,
  });

  let synthesis: MessagePerformanceSynthesis | null = null;
  if (opts.includeSynthesis) {
    const sample = await buildMessagePerformanceEvidenceSample({
      clientId: opts.clientId,
      rows: result.rows,
      attributionType: "cross_channel",
      maxPerBucket: opts.synthesisMaxPerBucket ?? 3,
      maxTotal: 18,
    });
    const synthRes = await synthesizeMessagePerformance({
      clientId: opts.clientId,
      windowFrom: opts.windowFrom,
      windowTo: opts.windowTo,
      metrics: result.metrics,
      stats: result.stats,
      samples: sample.samples,
      source: "message_performance_report",
    });
    synthesis = synthRes.synthesis;
  }

  const packId = await upsertMessagePerformancePack({
    clientId: opts.clientId,
    windowFrom: opts.windowFrom,
    windowTo: opts.windowTo,
    computedByUserId: opts.computedByUserId ?? null,
    computedByEmail: opts.computedByEmail ?? null,
    result,
    synthesis,
  });

  return { packId, result, synthesis };
}
