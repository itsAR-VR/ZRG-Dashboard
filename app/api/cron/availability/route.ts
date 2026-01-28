import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { withAiTelemetrySource } from "@/lib/ai/telemetry-context";
import { refreshAvailabilityCachesDue } from "@/lib/availability-cache";

// Vercel Serverless Functions (Pro) require maxDuration in [1, 800].
export const maxDuration = 60;

function isAuthorized(request: NextRequest): boolean {
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret) {
    console.warn("[Cron/Availability] CRON_SECRET not configured - endpoint disabled");
    return false;
  }

  const authHeader = request.headers.get("Authorization");
  const legacy = request.headers.get("x-cron-secret");

  return authHeader === `Bearer ${expectedSecret}` || legacy === expectedSecret;
}

const LOCK_KEY = BigInt("61061061061");

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

    const invocationId = crypto.randomUUID();

    try {
      const timeBudgetMsParam = request.nextUrl.searchParams.get("timeBudgetMs");
      const fromQuery = timeBudgetMsParam ? Number.parseInt(timeBudgetMsParam, 10) : null;
      const fromEnv = process.env.AVAILABILITY_CRON_TIME_BUDGET_MS
        ? Number.parseInt(process.env.AVAILABILITY_CRON_TIME_BUDGET_MS, 10)
        : null;
      const overallBudgetMs = Number.isFinite(fromQuery)
        ? Math.max(10_000, Math.min(55_000, fromQuery as number))
        : Number.isFinite(fromEnv)
          ? Math.max(10_000, Math.min(55_000, fromEnv as number))
          : 55_000;

      const concurrencyParam = request.nextUrl.searchParams.get("concurrency");
      const concurrency = concurrencyParam ? Number.parseInt(concurrencyParam, 10) : undefined;

      const defaultBudgetMs = Math.max(10_000, Math.floor(overallBudgetMs * 0.75));
      const directBudgetMs = Math.max(0, overallBudgetMs - defaultBudgetMs);

      const defaultResult = await refreshAvailabilityCachesDue({
        mode: "all",
        timeBudgetMs: defaultBudgetMs,
        concurrency,
        invocationId,
        availabilitySource: "DEFAULT",
      });

      const directBookResult =
        directBudgetMs >= 10_000
          ? await refreshAvailabilityCachesDue({
              mode: "all",
              timeBudgetMs: directBudgetMs,
              concurrency,
              invocationId,
              availabilitySource: "DIRECT_BOOK",
            })
          : null;

      return NextResponse.json({
        success: true,
        default: defaultResult,
        directBook: directBookResult,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[Cron/Availability] Error:", error);
      return NextResponse.json(
        {
          error: "Failed to refresh availability caches",
          message: error instanceof Error ? error.message : "Unknown error",
          invocationId,
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
