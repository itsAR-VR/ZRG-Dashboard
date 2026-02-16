import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAiTelemetrySource } from "@/lib/ai/telemetry-context";
import { processBackgroundJobs } from "@/lib/background-jobs/runner";
import { recoverStaleSendingDrafts } from "@/lib/ai-drafts/stale-sending-recovery";
import { inngest } from "@/lib/inngest/client";
import { INNGEST_EVENT_BACKGROUND_PROCESS_REQUESTED } from "@/lib/inngest/events";
import { LeadMemorySource } from "@prisma/client";

// Vercel Serverless Functions (Pro) require maxDuration in [1, 800].
export const maxDuration = 800;

function isAuthorized(request: NextRequest): boolean {
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret) {
    console.warn("[Cron] CRON_SECRET not configured - endpoint disabled");
    return false;
  }

  const authHeader = request.headers.get("Authorization");
  const legacy = request.headers.get("x-cron-secret");

  return authHeader === `Bearer ${expectedSecret}` || legacy === expectedSecret;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  return TRUE_VALUES.has(value.trim().toLowerCase());
}

function isInngestBackgroundTriggerEnabled(): boolean {
  return parseBoolean(process.env.BACKGROUND_JOBS_USE_INNGEST);
}

function getStaleQueueAlertMinutes(): number {
  return Math.max(5, parsePositiveInt(process.env.BACKGROUND_JOB_STALE_QUEUE_ALERT_MINUTES, 30));
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

export async function GET(request: NextRequest) {
  return withAiTelemetrySource(request.nextUrl.pathname, async () => {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      if (isInngestBackgroundTriggerEnabled()) {
        const requestedAt = new Date().toISOString();
        await inngest.send({
          name: INNGEST_EVENT_BACKGROUND_PROCESS_REQUESTED,
          data: {
            source: "cron/background-jobs",
            requestedAt,
          },
        });

        return NextResponse.json(
          {
            success: true,
            mode: "inngest",
            enqueued: true,
            requestedAt,
            timestamp: requestedAt,
          },
          { status: 202 }
        );
      }

      // Intentionally avoid session advisory locks here:
      // this route uses pooled connections and session locks can become orphaned.
      // Per-job row locking in processBackgroundJobs() already prevents double processing.
      const results = await processBackgroundJobs();
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
      const queueHealth = {
        dueNowCount: results.remaining,
        staleQueueAlertMinutes,
        oldestDueJobId: oldestDueJob?.id ?? null,
        oldestDueJobType: oldestDueJob?.type ?? null,
        oldestDueRunAt: oldestDueJob?.runAt?.toISOString() ?? null,
        oldestDueAgeMinutes,
        stale: oldestDueAgeMinutes !== null && oldestDueAgeMinutes >= staleQueueAlertMinutes,
      };

      if (queueHealth.stale) {
        console.error("[Cron] Background queue stale", {
          ...queueHealth,
          processed: results.processed,
          succeeded: results.succeeded,
          failed: results.failed,
          retried: results.retried,
          skipped: results.skipped,
        });
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

      return NextResponse.json({
        success: true,
        ...results,
        queueHealth,
        staleDraftRecovery,
        pruning,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[Cron] Background job processing error:", error);
      return NextResponse.json(
        {
          error: "Failed to process background jobs",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 }
      );
    }
  });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
