import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runMessagePerformanceEvaluationSystem } from "@/lib/message-performance-eval";
import { withAiTelemetrySource } from "@/lib/ai/telemetry-context";

export const maxDuration = 800;

function isAuthorized(request: NextRequest): boolean {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) return false;
  const authHeader = request.headers.get("Authorization");
  const legacySecret = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${expectedSecret}` || legacySecret === expectedSecret;
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));
}

export async function GET(request: NextRequest) {
  return withAiTelemetrySource(request.nextUrl.pathname, async () => {
    const expectedSecret = process.env.CRON_SECRET;
    if (!expectedSecret) {
      console.warn("[MessagePerformance Eval Cron] CRON_SECRET not configured - endpoint disabled");
      return NextResponse.json({ error: "Cron endpoint not configured" }, { status: 503 });
    }
    if (!isAuthorized(request)) {
      console.warn("[MessagePerformance Eval Cron] Invalid authorization attempt");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limit = Math.max(1, parsePositiveIntEnv("INSIGHTS_MESSAGE_PERFORMANCE_EVAL_CRON_LIMIT", 5));
    const windowDays = parsePositiveIntEnv("MESSAGE_PERFORMANCE_WINDOW_DAYS", 30);
    const minDaysBetweenRuns = parsePositiveIntEnv("MESSAGE_PERFORMANCE_EVAL_CRON_MIN_DAYS", 6);

    const candidates = await prisma.workspaceSettings.findMany({
      where: { messagePerformanceWeeklyEnabled: true },
      select: { clientId: true },
      take: limit,
    });

    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of candidates) {
      try {
        const latest = await prisma.messagePerformanceEvalRun.findFirst({
          where: { clientId: row.clientId, status: "COMPLETE" },
          orderBy: { computedAt: "desc" },
          select: { computedAt: true, updatedAt: true },
        });
        const lastComputedAt = latest?.computedAt ?? latest?.updatedAt ?? null;
        if (lastComputedAt && daysBetween(new Date(), lastComputedAt) < minDaysBetweenRuns) {
          skipped += 1;
          continue;
        }

        const windowTo = new Date();
        const windowFrom = new Date(windowTo.getTime() - windowDays * 24 * 60 * 60 * 1000);

        await runMessagePerformanceEvaluationSystem({
          clientId: row.clientId,
          windowFrom,
          windowTo,
          computedByUserId: null,
          computedByEmail: "cron",
        });

        processed += 1;
      } catch (error) {
        failed += 1;
        console.error("[MessagePerformance Eval Cron] Failed:", { clientId: row.clientId, error });
      }
    }

    return NextResponse.json({
      success: true,
      candidates: candidates.length,
      processed,
      skipped,
      failed,
      limit,
      timestamp: new Date().toISOString(),
    });
  });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
