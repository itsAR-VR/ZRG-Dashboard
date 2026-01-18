import { NextRequest, NextResponse } from "next/server";
import { prisma, withDbRetry, isPrismaConnectionError } from "@/lib/prisma";
import { runInsightContextPackStepSystem, ensureSeedAnswerSystem } from "@/lib/insights-chat/context-pack-worker";
import { withAiTelemetrySource } from "@/lib/ai/telemetry-context";

// Vercel Serverless Functions (Pro) support maxDuration in [1, 800].
export const maxDuration = 800;

// Circuit breaker: stop processing after this many consecutive P1001 errors
const MAX_CONNECTION_ERRORS = 3;

function isAuthorized(request: NextRequest): boolean {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) return false;
  const authHeader = request.headers.get("Authorization");
  const legacySecret = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${expectedSecret}` || legacySecret === expectedSecret;
}

export async function GET(request: NextRequest) {
  return withAiTelemetrySource(request.nextUrl.pathname, async () => {
    const expectedSecret = process.env.CRON_SECRET;
    if (!expectedSecret) {
      console.warn("[Insights Cron] CRON_SECRET not configured - endpoint disabled");
      return NextResponse.json({ error: "Cron endpoint not configured" }, { status: 503 });
    }
    if (!isAuthorized(request)) {
      console.warn("[Insights Cron] Invalid authorization attempt");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const packLimit = Math.max(1, Number.parseInt(process.env.INSIGHTS_CONTEXT_PACK_CRON_LIMIT || "3", 10) || 3);
    // Reduced from 25 to 15 to lower DB connection pressure
    const maxThreadsToProcess = Math.max(
      1,
      Math.min(15, Number.parseInt(process.env.INSIGHTS_CONTEXT_PACK_CRON_BATCH || "15", 10) || 15)
    );

    let connectionErrors = 0;

    try {
      // Wrap initial DB query with retry for P1001
      const packs = await withDbRetry(
        () =>
          prisma.insightContextPack.findMany({
            where: {
              deletedAt: null,
              status: { in: ["PENDING", "RUNNING"] },
              session: { deletedAt: null },
            },
            select: { id: true, clientId: true, sessionId: true, status: true, processedThreads: true, targetThreadsTotal: true },
            orderBy: { updatedAt: "asc" },
            take: packLimit,
          }),
        { maxRetries: 2 }
      );

      let stepped = 0;
      let progressed = 0;
      let completed = 0;
      let failed = 0;
      let seeded = 0;

      for (const pack of packs) {
        // Circuit breaker: stop processing if we've hit too many connection errors
        if (connectionErrors >= MAX_CONNECTION_ERRORS) {
          console.warn(`[Insights Cron] Circuit breaker triggered after ${connectionErrors} connection errors, stopping early`);
          break;
        }

        stepped++;
        try {
          const res = await runInsightContextPackStepSystem({ contextPackId: pack.id, maxThreadsToProcess });
          if (!res) continue;
          progressed++;
          if (res.status === "COMPLETE") {
            completed++;
            const seedRes = await ensureSeedAnswerSystem({ contextPackId: res.contextPackId, force: false });
            if (seedRes.created) seeded++;
          } else if (res.status === "FAILED") {
            failed++;
          }
        } catch (error) {
          if (isPrismaConnectionError(error)) {
            connectionErrors++;
            console.error(`[Insights Cron] Connection error processing pack ${pack.id} (${connectionErrors}/${MAX_CONNECTION_ERRORS})`);
          } else {
            throw error;
          }
        }
      }

      // Skip orphan processing if circuit breaker is triggered
      if (connectionErrors < MAX_CONNECTION_ERRORS) {
        // Best-effort: if a pack is COMPLETE but never got a seed answer due to earlier issues,
        // we can still try to create the initial assistant answer (only when the session has no assistant messages).
        const orphaned = await withDbRetry(
          () =>
            prisma.insightContextPack.findMany({
              where: {
                deletedAt: null,
                status: "COMPLETE",
                seedAssistantMessageId: null,
                session: { deletedAt: null },
              },
              select: { id: true },
              orderBy: { updatedAt: "asc" },
              take: Math.max(0, packLimit - completed),
            }),
          { maxRetries: 2 }
        );

        for (const pack of orphaned) {
          if (connectionErrors >= MAX_CONNECTION_ERRORS) break;
          try {
            const seedRes = await ensureSeedAnswerSystem({ contextPackId: pack.id, force: false });
            if (seedRes.created) seeded++;
          } catch (error) {
            if (isPrismaConnectionError(error)) {
              connectionErrors++;
              console.error(`[Insights Cron] Connection error seeding pack ${pack.id} (${connectionErrors}/${MAX_CONNECTION_ERRORS})`);
            } else {
              throw error;
            }
          }
        }
      }

      // If we had connection errors but completed some work, still return success with warning
      if (connectionErrors > 0) {
        console.warn(`[Insights Cron] Completed with ${connectionErrors} connection errors`);
      }

      return NextResponse.json({
        success: true,
        packLimit,
        maxThreadsToProcess,
        stepped,
        progressed,
        completed,
        failed,
        seeded,
        connectionErrors,
        circuitBreakerTriggered: connectionErrors >= MAX_CONNECTION_ERRORS,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // Check if initial DB query failed completely
      if (isPrismaConnectionError(error)) {
        console.error("[Insights Cron] Database unreachable, skipping this invocation");
        return NextResponse.json(
          {
            success: false,
            error: "Database unreachable",
            db_unreachable: true,
            packLimit,
            maxThreadsToProcess,
            timestamp: new Date().toISOString(),
          },
          { status: 503 }
        );
      }

      console.error("[Insights Cron] Error:", error);
      return NextResponse.json(
        { error: "Failed to process insight context packs", message: error instanceof Error ? error.message : "Unknown error" },
        { status: 500 }
      );
    }
  });
}

export async function POST(request: NextRequest) {
  // Alias for manual triggers/external cron services.
  return GET(request);
}
