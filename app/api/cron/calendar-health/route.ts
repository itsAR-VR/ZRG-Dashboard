import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

import { prisma } from "@/lib/prisma";
import { withAiTelemetrySource } from "@/lib/ai/telemetry-context";
import { runCalendarHealthChecks } from "@/lib/calendar-health-runner";
import { computeEtWeekKey, sendWeeklyCalendarHealthSlackAlerts } from "@/lib/calendar-health-notifications";

// Vercel Serverless Functions (Pro) require maxDuration in [1, 800].
export const maxDuration = 60;

function isAuthorized(request: NextRequest): boolean {
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret) {
    console.warn("[Cron/CalendarHealth] CRON_SECRET not configured - endpoint disabled");
    return false;
  }

  const authHeader = request.headers.get("Authorization");
  const legacy = request.headers.get("x-cron-secret");

  return authHeader === `Bearer ${expectedSecret}` || legacy === expectedSecret;
}

const LOCK_KEY = BigInt("62062062062");

async function tryAcquireLock(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ locked: boolean }>>`select pg_try_advisory_lock(${LOCK_KEY}) as locked`;
  return Boolean(rows?.[0]?.locked);
}

async function releaseLock(): Promise<void> {
  await prisma.$queryRaw`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => undefined);
}

function getEtParts(date: Date): { weekday: number; hour: number; minute: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = dtf.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string | undefined => parts.find((p) => p.type === type)?.value;

  const weekdayLabel = get("weekday") || "Sun";
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[weekdayLabel] ?? 0;

  let hour = Number.parseInt(get("hour") || "0", 10);
  if (hour === 24) hour = 0;
  const minute = Number.parseInt(get("minute") || "0", 10);

  return {
    weekday,
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number.isFinite(minute) ? minute : 0,
  };
}

function isTruthyQuery(value: string | null): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "y";
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
    const now = new Date();

    try {
      const force = isTruthyQuery(request.nextUrl.searchParams.get("force"));
      const clientId = request.nextUrl.searchParams.get("clientId");

      const et = getEtParts(now);
      const shouldRun = et.weekday === 0 && et.hour === 18;

      if (!force && !shouldRun) {
        return NextResponse.json({
          success: true,
          skipped: true,
          reason: "outside_window",
          et,
          timestamp: now.toISOString(),
        });
      }

      const concurrencyParam = request.nextUrl.searchParams.get("concurrency");
      const timeBudgetParam = request.nextUrl.searchParams.get("timeBudgetMs");

      const concurrency = concurrencyParam ? Number.parseInt(concurrencyParam, 10) : undefined;
      const timeBudgetMs = timeBudgetParam ? Number.parseInt(timeBudgetParam, 10) : undefined;

      const check = await runCalendarHealthChecks({
        clientId: clientId ? clientId : undefined,
        now,
        windowDays: 7,
        weekdaysOnly: true,
        ...(Number.isFinite(concurrency) ? { concurrency } : {}),
        ...(Number.isFinite(timeBudgetMs) ? { timeBudgetMs } : {}),
      });

      const weekKey = computeEtWeekKey(now);

      const notifications = await sendWeeklyCalendarHealthSlackAlerts({
        workspaces: check.workspaces,
        weekKey,
      });

      return NextResponse.json({
        success: true,
        invocationId,
        weekKey,
        et,
        check: {
          checkedWorkspaces: check.checkedWorkspaces,
          checkedCalendarLinks: check.checkedCalendarLinks,
          flaggedCalendarLinks: check.flaggedCalendarLinks,
          finishedWithinBudget: check.finishedWithinBudget,
          errors: check.errors,
        },
        notifications,
        timestamp: now.toISOString(),
      });
    } catch (error) {
      console.error("[Cron/CalendarHealth] Error:", error);
      return NextResponse.json(
        {
          error: "Failed to run calendar health check",
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

