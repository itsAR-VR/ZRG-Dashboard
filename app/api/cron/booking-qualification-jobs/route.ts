import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAiTelemetrySource } from "@/lib/ai/telemetry-context";
import { processBookingQualificationJobs } from "@/lib/booking-qualification-jobs/runner";

// Vercel Serverless Functions (Pro) require maxDuration in [1, 800].
export const maxDuration = 800;

const LOCK_KEY = BigInt("65065065065");

function isAuthorized(request: NextRequest): boolean {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    console.warn("[Cron/BookingQualification] CRON_SECRET not configured - endpoint disabled");
    return false;
  }

  const authHeader = request.headers.get("Authorization");
  const legacy = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${expectedSecret}` || legacy === expectedSecret;
}

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
      const results = await processBookingQualificationJobs();
      return NextResponse.json({
        success: true,
        ...results,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[Cron/BookingQualification] Processing error:", error);
      return NextResponse.json(
        {
          error: "Failed to process booking qualification jobs",
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
