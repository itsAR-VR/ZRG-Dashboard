import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAiTelemetrySource } from "@/lib/ai/telemetry-context";
import { processBackgroundJobs } from "@/lib/background-jobs/runner";

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

const LOCK_KEY = BigInt("63063063063");

async function tryAcquireLock(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ locked: boolean }>>`select pg_try_advisory_lock(${LOCK_KEY}) as locked`;
  return Boolean(rows?.[0]?.locked);
}

async function releaseLock(): Promise<void> {
  await prisma.$queryRaw`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => undefined);
}

export async function GET(request: NextRequest) {
  return withAiTelemetrySource(request.nextUrl.pathname, async () => {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const acquired = await tryAcquireLock();
    if (!acquired) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: "locked",
        timestamp: new Date().toISOString(),
      });
    }

    try {
      const results = await processBackgroundJobs();
      return NextResponse.json({
        success: true,
        ...results,
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
    } finally {
      await releaseLock();
    }
  });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
