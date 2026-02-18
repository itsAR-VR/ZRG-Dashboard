import { NextRequest, NextResponse } from "next/server";

import { withAiTelemetrySource } from "@/lib/ai/telemetry-context";
import { runFollowupsCron } from "@/lib/cron/followups";
import {
  buildCronDispatchContext,
  buildCronEventId,
  isInngestConfigured,
  parseBooleanFlag,
} from "@/lib/inngest/cron-dispatch";
import { inngest } from "@/lib/inngest/client";
import { INNGEST_EVENT_CRON_FOLLOWUPS_REQUESTED } from "@/lib/inngest/events";
import { prisma } from "@/lib/prisma";

// Vercel Serverless Functions (Pro) require maxDuration in [1, 800].
export const maxDuration = 800;

const LOCK_KEY = BigInt("64064064064");

function isDispatchEnabled(): boolean {
  return parseBooleanFlag(process.env.CRON_FOLLOWUPS_USE_INNGEST);
}

async function tryAcquireLock(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ locked: boolean }>>`select pg_try_advisory_lock(${LOCK_KEY}) as locked`;
  return Boolean(rows?.[0]?.locked);
}

async function releaseLock(): Promise<void> {
  await prisma.$queryRaw`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => undefined);
}

async function enqueueFollowupsDispatch(): Promise<NextResponse> {
  if (!isInngestConfigured()) {
    return NextResponse.json(
      {
        success: false,
        mode: "dispatch-misconfigured",
        error: "Inngest dispatch is enabled but INNGEST_EVENT_KEY is not configured",
      },
      { status: 503 }
    );
  }

  const { requestedAt, dispatchData } = buildCronDispatchContext({
    job: "followups",
    source: "cron/followups",
    dispatchWindowSeconds: 60,
  });
  const eventId = buildCronEventId(INNGEST_EVENT_CRON_FOLLOWUPS_REQUESTED, dispatchData.dispatchKey);

  try {
    const sendResult = await inngest.send({
      id: eventId,
      name: INNGEST_EVENT_CRON_FOLLOWUPS_REQUESTED,
      data: dispatchData,
    });
    const publishedEventIds = Array.isArray(sendResult?.ids) ? sendResult.ids : [];

    return NextResponse.json(
      {
        success: true,
        mode: "dispatch-only",
        dispatch: dispatchData,
        event: {
          name: INNGEST_EVENT_CRON_FOLLOWUPS_REQUESTED,
          id: eventId,
        },
        publishedEventIds,
        timestamp: requestedAt,
      },
      { status: 202 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Cron] Follow-up dispatch enqueue failed:", error);
    return NextResponse.json(
      {
        success: false,
        mode: "dispatch-failed",
        enqueueError: message,
        dispatch: dispatchData,
        event: {
          name: INNGEST_EVENT_CRON_FOLLOWUPS_REQUESTED,
          id: eventId,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}

/**
 * GET /api/cron/followups
 *
 * Processes all due follow-up instances.
 * Called automatically by Vercel Cron (configured in vercel.json)
 *
 * Security: Requires Authorization: Bearer <CRON_SECRET> header
 * Vercel automatically adds this header when invoking cron jobs
 */
export async function GET(request: NextRequest) {
  return withAiTelemetrySource(request.nextUrl.pathname, async () => {
    try {
      // Verify cron secret using Vercel's Bearer token pattern
      const authHeader = request.headers.get("Authorization");
      const expectedSecret = process.env.CRON_SECRET;

      if (!expectedSecret) {
        console.warn("[Cron] CRON_SECRET not configured - endpoint disabled");
        return NextResponse.json({ error: "Cron endpoint not configured" }, { status: 503 });
      }

      if (authHeader !== `Bearer ${expectedSecret}`) {
        console.warn("[Cron] Invalid authorization attempt");
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      if (isDispatchEnabled()) {
        return enqueueFollowupsDispatch();
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
        return await runFollowupsCron(request.nextUrl.pathname);
      } finally {
        await releaseLock();
      }
    } catch (error) {
      console.error("[Cron] Follow-up processing error:", error);
      return NextResponse.json(
        {
          error: "Failed to process follow-ups",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 }
      );
    }
  });
}

/**
 * POST /api/cron/followups
 *
 * Alternative endpoint for manual triggering or external cron services
 * Uses x-cron-secret header for backwards compatibility
 */
export async function POST(request: NextRequest) {
  return withAiTelemetrySource(request.nextUrl.pathname, async () => {
    try {
      // Check both Authorization header (Vercel pattern) and x-cron-secret (legacy)
      const authHeader = request.headers.get("Authorization");
      const legacySecret = request.headers.get("x-cron-secret");
      const expectedSecret = process.env.CRON_SECRET;

      if (!expectedSecret) {
        console.warn("[Cron] CRON_SECRET not configured - endpoint disabled");
        return NextResponse.json({ error: "Cron endpoint not configured" }, { status: 503 });
      }

      const isAuthorized = authHeader === `Bearer ${expectedSecret}` || legacySecret === expectedSecret;

      if (!isAuthorized) {
        console.warn("[Cron] Invalid authorization attempt");
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      if (isDispatchEnabled()) {
        return enqueueFollowupsDispatch();
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
        return await runFollowupsCron(request.nextUrl.pathname);
      } finally {
        await releaseLock();
      }
    } catch (error) {
      console.error("[Cron] Follow-up processing error:", error);
      return NextResponse.json(
        {
          error: "Failed to process follow-ups",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 }
      );
    }
  });
}
