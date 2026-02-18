import { NextRequest, NextResponse } from "next/server";
import { withAiTelemetrySource } from "@/lib/ai/telemetry-context";
import { runEmailBisonAvailabilitySlotCron } from "@/lib/cron/emailbison-availability-slot";
import {
  buildCronDispatchContext,
  buildCronEventId,
  isInngestConfigured,
  parseBooleanFlag,
} from "@/lib/inngest/cron-dispatch";
import { inngest } from "@/lib/inngest/client";
import { INNGEST_EVENT_CRON_EMAILBISON_AVAILABILITY_SLOT_REQUESTED } from "@/lib/inngest/events";

// Vercel Serverless Functions (Pro) require maxDuration in [1, 800].
export const maxDuration = 800;

function isDispatchEnabled(): boolean {
  return parseBooleanFlag(process.env.CRON_EMAILBISON_AVAILABILITY_SLOT_USE_INNGEST);
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

async function enqueueEmailBisonAvailabilityDispatch(): Promise<NextResponse> {
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
    job: "emailbison-availability-slot",
    source: "cron/emailbison-availability-slot",
    dispatchWindowSeconds: 60,
  });
  const eventId = buildCronEventId(
    INNGEST_EVENT_CRON_EMAILBISON_AVAILABILITY_SLOT_REQUESTED,
    dispatchData.dispatchKey
  );

  try {
    const sendResult = await inngest.send({
      id: eventId,
      name: INNGEST_EVENT_CRON_EMAILBISON_AVAILABILITY_SLOT_REQUESTED,
      data: dispatchData,
    });
    const publishedEventIds = Array.isArray(sendResult?.ids) ? sendResult.ids : [];

    return NextResponse.json(
      {
        success: true,
        mode: "dispatch-only",
        dispatch: dispatchData,
        event: {
          name: INNGEST_EVENT_CRON_EMAILBISON_AVAILABILITY_SLOT_REQUESTED,
          id: eventId,
        },
        publishedEventIds,
        timestamp: requestedAt,
      },
      { status: 202 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Cron] EmailBison availability-slot dispatch enqueue failed:", error);
    return NextResponse.json(
      {
        success: false,
        mode: "dispatch-failed",
        enqueueError: message,
        dispatch: dispatchData,
        event: {
          name: INNGEST_EVENT_CRON_EMAILBISON_AVAILABILITY_SLOT_REQUESTED,
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
      return enqueueEmailBisonAvailabilityDispatch();
    }

    try {
      const result = await runEmailBisonAvailabilitySlotCron(request.nextUrl.searchParams);

      return NextResponse.json({
        success: true,
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[Cron] EmailBison availability-slot error:", error);
      return NextResponse.json(
        {
          success: false,
          errors: [error instanceof Error ? error.message : String(error)],
          error: "Failed to process EmailBison availability slots",
          message: error instanceof Error ? error.message : "Unknown error",
          timestamp: new Date().toISOString(),
        },
        { status: 200 }
      );
    }
  });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
