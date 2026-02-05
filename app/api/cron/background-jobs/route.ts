import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAiTelemetrySource } from "@/lib/ai/telemetry-context";
import { processBackgroundJobs } from "@/lib/background-jobs/runner";
import { recoverStaleSendingDrafts } from "@/lib/ai-drafts/stale-sending-recovery";

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

function getStaleQueueAlertMinutes(): number {
  return Math.max(5, parsePositiveInt(process.env.BACKGROUND_JOB_STALE_QUEUE_ALERT_MINUTES, 30));
}

export async function GET(request: NextRequest) {
  return withAiTelemetrySource(request.nextUrl.pathname, async () => {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
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
      return NextResponse.json({
        success: true,
        ...results,
        queueHealth,
        staleDraftRecovery,
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
