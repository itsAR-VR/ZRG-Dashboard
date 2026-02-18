import { NextRequest, NextResponse } from "next/server";

import { runResponseTimingCron } from "@/lib/cron/response-timing";
import {
  buildCronDispatchContext,
  buildCronEventId,
  isInngestConfigured,
  parseBooleanFlag,
} from "@/lib/inngest/cron-dispatch";
import { inngest } from "@/lib/inngest/client";
import { INNGEST_EVENT_CRON_RESPONSE_TIMING_REQUESTED } from "@/lib/inngest/events";

// Vercel Serverless Functions (Pro) require maxDuration in [1, 800].
export const maxDuration = 800;

function isDispatchEnabled(): boolean {
  return parseBooleanFlag(process.env.CRON_RESPONSE_TIMING_USE_INNGEST);
}

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

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isDispatchEnabled()) {
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
      job: "response-timing",
      source: "cron/response-timing",
      dispatchWindowSeconds: 5 * 60,
    });
    const eventId = buildCronEventId(INNGEST_EVENT_CRON_RESPONSE_TIMING_REQUESTED, dispatchData.dispatchKey);

    try {
      const sendResult = await inngest.send({
        id: eventId,
        name: INNGEST_EVENT_CRON_RESPONSE_TIMING_REQUESTED,
        data: dispatchData,
      });
      const publishedEventIds = Array.isArray(sendResult?.ids) ? sendResult.ids : [];

      return NextResponse.json(
        {
          success: true,
          mode: "dispatch-only",
          dispatch: dispatchData,
          event: {
            name: INNGEST_EVENT_CRON_RESPONSE_TIMING_REQUESTED,
            id: eventId,
          },
          publishedEventIds,
          timestamp: requestedAt,
        },
        { status: 202 }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Cron] Response timing dispatch enqueue failed:", error);
      return NextResponse.json(
        {
          success: false,
          mode: "dispatch-failed",
          enqueueError: message,
          dispatch: dispatchData,
          event: {
            name: INNGEST_EVENT_CRON_RESPONSE_TIMING_REQUESTED,
            id: eventId,
          },
          timestamp: new Date().toISOString(),
        },
        { status: 503 }
      );
    }
  }

  try {
    const result = await runResponseTimingCron();
    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Cron] Response timing processing error:", error);
    return NextResponse.json(
      {
        error: "Failed to process response timing",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
