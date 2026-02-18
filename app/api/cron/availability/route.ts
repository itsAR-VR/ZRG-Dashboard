import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { runAvailabilityCron } from "@/lib/cron/availability";
import { prisma } from "@/lib/prisma";
import { withAiTelemetrySource } from "@/lib/ai/telemetry-context";
import {
  buildCronDispatchContext,
  buildCronEventId,
  isInngestConfigured,
  parseBooleanFlag,
} from "@/lib/inngest/cron-dispatch";
import { inngest } from "@/lib/inngest/client";
import { INNGEST_EVENT_CRON_AVAILABILITY_REQUESTED } from "@/lib/inngest/events";

// Vercel Serverless Functions (Pro) require maxDuration in [1, 800].
export const maxDuration = 800;

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

function isDispatchEnabled(): boolean {
  return parseBooleanFlag(process.env.CRON_AVAILABILITY_USE_INNGEST);
}

async function tryAcquireLock(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ locked: boolean }>>`select pg_try_advisory_lock(${LOCK_KEY}) as locked`;
  return Boolean(rows?.[0]?.locked);
}

async function releaseLock(): Promise<void> {
  await prisma.$queryRaw`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => undefined);
}

async function enqueueAvailabilityDispatch(): Promise<NextResponse> {
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
    job: "availability",
    source: "cron/availability",
    dispatchWindowSeconds: 60,
  });
  const eventId = buildCronEventId(INNGEST_EVENT_CRON_AVAILABILITY_REQUESTED, dispatchData.dispatchKey);

  try {
    const sendResult = await inngest.send({
      id: eventId,
      name: INNGEST_EVENT_CRON_AVAILABILITY_REQUESTED,
      data: dispatchData,
    });
    const publishedEventIds = Array.isArray(sendResult?.ids) ? sendResult.ids : [];

    return NextResponse.json(
      {
        success: true,
        mode: "dispatch-only",
        dispatch: dispatchData,
        event: {
          name: INNGEST_EVENT_CRON_AVAILABILITY_REQUESTED,
          id: eventId,
        },
        publishedEventIds,
        timestamp: requestedAt,
      },
      { status: 202 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Cron/Availability] Dispatch enqueue failed:", error);
    return NextResponse.json(
      {
        success: false,
        mode: "dispatch-failed",
        enqueueError: message,
        dispatch: dispatchData,
        event: {
          name: INNGEST_EVENT_CRON_AVAILABILITY_REQUESTED,
          id: eventId,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}

export async function GET(request: NextRequest) {
  return withAiTelemetrySource(request.nextUrl.pathname, async () => {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (isDispatchEnabled()) {
      return enqueueAvailabilityDispatch();
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
      const result = await runAvailabilityCron(request.nextUrl.searchParams, invocationId);

      return NextResponse.json({
        success: true,
        ...result,
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
