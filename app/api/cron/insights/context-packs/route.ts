import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runInsightContextPackStepSystem, ensureSeedAnswerSystem } from "@/lib/insights-chat/context-pack-worker";
import { withAiTelemetrySource } from "@/lib/ai/telemetry-context";

// Vercel Serverless Functions (Pro) support maxDuration in [1, 800].
export const maxDuration = 800;

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
    const maxThreadsToProcess = Math.max(
      1,
      Math.min(25, Number.parseInt(process.env.INSIGHTS_CONTEXT_PACK_CRON_BATCH || "25", 10) || 25)
    );

    try {
      const packs = await prisma.insightContextPack.findMany({
        where: {
          deletedAt: null,
          status: { in: ["PENDING", "RUNNING"] },
          session: { deletedAt: null },
        },
        select: { id: true, clientId: true, sessionId: true, status: true, processedThreads: true, targetThreadsTotal: true },
        orderBy: { updatedAt: "asc" },
        take: packLimit,
      });

      let stepped = 0;
      let progressed = 0;
      let completed = 0;
      let failed = 0;
      let seeded = 0;

      for (const pack of packs) {
        stepped++;
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
      }

      // Best-effort: if a pack is COMPLETE but never got a seed answer due to earlier issues,
      // we can still try to create the initial assistant answer (only when the session has no assistant messages).
      const orphaned = await prisma.insightContextPack.findMany({
        where: {
          deletedAt: null,
          status: "COMPLETE",
          seedAssistantMessageId: null,
          session: { deletedAt: null },
        },
        select: { id: true },
        orderBy: { updatedAt: "asc" },
        take: Math.max(0, packLimit - completed),
      });

      for (const pack of orphaned) {
        const seedRes = await ensureSeedAnswerSystem({ contextPackId: pack.id, force: false });
        if (seedRes.created) seeded++;
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
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
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
