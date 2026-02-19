import "server-only";

import { LeadMemorySource } from "@prisma/client";

import { recoverStaleSendingDrafts } from "@/lib/ai-drafts/stale-sending-recovery";
import { prisma } from "@/lib/prisma";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getStaleQueueAlertMinutes(): number {
  return Math.max(5, parsePositiveInt(process.env.BACKGROUND_JOB_STALE_QUEUE_ALERT_MINUTES, 30));
}

function getStaleFunctionRunAlertMinutes(): number {
  return Math.max(5, parsePositiveInt(process.env.BACKGROUND_FUNCTION_RUN_STALE_MINUTES, 15));
}

function getDraftPipelineRetentionDays(): number {
  return Math.max(1, parsePositiveInt(process.env.DRAFT_PIPELINE_RUN_RETENTION_DAYS, 30));
}

async function pruneDraftPipelineRuns(opts: { cutoff: Date; limit: number }): Promise<number> {
  const candidates = await prisma.draftPipelineRun.findMany({
    where: { createdAt: { lt: opts.cutoff } },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(1000, Math.trunc(opts.limit))),
    select: { id: true },
  });
  const ids = candidates.map((c) => c.id);
  if (ids.length === 0) return 0;
  // Artifacts cascade via DraftPipelineArtifact.run onDelete: Cascade.
  const res = await prisma.draftPipelineRun.deleteMany({ where: { id: { in: ids } } });
  return typeof (res as any)?.count === "number" ? (res as any).count : ids.length;
}

async function pruneExpiredInferredLeadMemory(opts: { now: Date; limit: number }): Promise<number> {
  const candidates = await prisma.leadMemoryEntry.findMany({
    where: { source: LeadMemorySource.INFERENCE, expiresAt: { lt: opts.now } },
    orderBy: { expiresAt: "asc" },
    take: Math.max(1, Math.min(2000, Math.trunc(opts.limit))),
    select: { id: true },
  });
  const ids = candidates.map((c) => c.id);
  if (ids.length === 0) return 0;
  const res = await prisma.leadMemoryEntry.deleteMany({ where: { id: { in: ids } } });
  return typeof (res as any)?.count === "number" ? (res as any).count : ids.length;
}

async function pruneExpiredInferredWorkspaceMemory(opts: { now: Date; limit: number }): Promise<number> {
  const candidates = await prisma.workspaceMemoryEntry.findMany({
    where: { source: LeadMemorySource.INFERENCE, expiresAt: { lt: opts.now } },
    orderBy: { expiresAt: "asc" },
    take: Math.max(1, Math.min(2000, Math.trunc(opts.limit))),
    select: { id: true },
  });
  const ids = candidates.map((c) => c.id);
  if (ids.length === 0) return 0;
  const res = await prisma.workspaceMemoryEntry.deleteMany({ where: { id: { in: ids } } });
  return typeof (res as any)?.count === "number" ? (res as any).count : ids.length;
}

export type BackgroundMaintenanceResult = {
  queueHealth: {
    dueNowCount: number;
    staleQueueAlertMinutes: number;
    oldestDueJobId: string | null;
    oldestDueJobType: string | null;
    oldestDueRunAt: string | null;
    oldestDueAgeMinutes: number | null;
    stale: boolean;
  };
  functionRunHealth: {
    functionName: string;
    staleRunAlertMinutes: number;
    runningCount: number;
    oldestRunningRunId: string | null;
    oldestRunningRunKey: string | null;
    oldestRunningStartedAt: string | null;
    oldestRunningAgeMinutes: number | null;
    stale: boolean;
  };
  staleDraftRecovery: {
    checked: number;
    recovered: number;
    missingMessages: number;
    errors: string[];
  };
  pruning: {
    retentionDays: number;
    cutoffIso: string;
    runsPruned?: number;
    leadMemoryPruned?: number;
    workspaceMemoryPruned?: number;
    error?: string;
  };
};

export async function runBackgroundMaintenance(opts?: {
  dueNowCount?: number;
}): Promise<BackgroundMaintenanceResult> {
  const now = new Date();
  const staleQueueAlertMinutes = getStaleQueueAlertMinutes();
  const oldestDueJob = await prisma.backgroundJob.findFirst({
    where: {
      status: "PENDING",
      runAt: { lte: now },
    },
    orderBy: { runAt: "asc" },
    select: {
      id: true,
      type: true,
      runAt: true,
    },
  });
  const oldestDueAgeMinutes = oldestDueJob
    ? Math.max(0, Math.floor((now.getTime() - oldestDueJob.runAt.getTime()) / 60_000))
    : null;

  const dueNowCount =
    typeof opts?.dueNowCount === "number"
      ? opts.dueNowCount
      : await prisma.backgroundJob.count({
          where: { status: "PENDING", runAt: { lte: now } },
        });

  const queueHealth = {
    dueNowCount,
    staleQueueAlertMinutes,
    oldestDueJobId: oldestDueJob?.id ?? null,
    oldestDueJobType: oldestDueJob?.type ?? null,
    oldestDueRunAt: oldestDueJob?.runAt?.toISOString() ?? null,
    oldestDueAgeMinutes,
    stale: oldestDueAgeMinutes !== null && oldestDueAgeMinutes >= staleQueueAlertMinutes,
  };

  if (queueHealth.stale) {
    console.error("[Background Maintenance] Queue stale", queueHealth);
  }

  const staleRunAlertMinutes = getStaleFunctionRunAlertMinutes();
  const [runningFunctionCount, oldestRunningFunction] = await Promise.all([
    prisma.backgroundFunctionRun.count({
      where: {
        functionName: "process-background-jobs",
        status: "RUNNING",
      },
    }),
    prisma.backgroundFunctionRun.findFirst({
      where: {
        functionName: "process-background-jobs",
        status: "RUNNING",
      },
      orderBy: { startedAt: "asc" },
      select: {
        id: true,
        runKey: true,
        startedAt: true,
      },
    }),
  ]);

  const oldestRunningAgeMinutes = oldestRunningFunction
    ? Math.max(0, Math.floor((now.getTime() - oldestRunningFunction.startedAt.getTime()) / 60_000))
    : null;

  const functionRunHealth = {
    functionName: "process-background-jobs",
    staleRunAlertMinutes,
    runningCount: runningFunctionCount,
    oldestRunningRunId: oldestRunningFunction?.id ?? null,
    oldestRunningRunKey: oldestRunningFunction?.runKey ?? null,
    oldestRunningStartedAt: oldestRunningFunction?.startedAt?.toISOString() ?? null,
    oldestRunningAgeMinutes,
    stale: oldestRunningAgeMinutes !== null && oldestRunningAgeMinutes >= staleRunAlertMinutes,
  };

  if (functionRunHealth.stale) {
    console.error("[Background Maintenance] Function run stale", functionRunHealth);
  }

  const staleDraftRecovery = await recoverStaleSendingDrafts().catch((error) => ({
    checked: 0,
    recovered: 0,
    missingMessages: 0,
    errors: [error instanceof Error ? error.message : "Unknown error"],
  }));

  const retentionDays = getDraftPipelineRetentionDays();
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);

  const pruning = await (async () => {
    try {
      const [runsPruned, leadMemoryPruned, workspaceMemoryPruned] = await Promise.all([
        pruneDraftPipelineRuns({ cutoff, limit: 250 }),
        pruneExpiredInferredLeadMemory({ now, limit: 500 }),
        pruneExpiredInferredWorkspaceMemory({ now, limit: 500 }),
      ]);
      return {
        retentionDays,
        cutoffIso: cutoff.toISOString(),
        runsPruned,
        leadMemoryPruned,
        workspaceMemoryPruned,
      };
    } catch (error) {
      return {
        retentionDays,
        cutoffIso: cutoff.toISOString(),
        error: error instanceof Error ? error.message : "prune_failed",
      };
    }
  })();

  return {
    queueHealth,
    functionRunHealth,
    staleDraftRecovery,
    pruning,
  };
}
