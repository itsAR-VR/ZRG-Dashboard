import { NextRequest, NextResponse } from "next/server";
import { withAiTelemetrySource } from "@/lib/ai/telemetry-context";
import { runBackgroundMaintenance } from "@/lib/background-jobs/maintenance";
import { processBackgroundJobs } from "@/lib/background-jobs/runner";
import { inngest } from "@/lib/inngest/client";
import {
  INNGEST_EVENT_BACKGROUND_MAINTENANCE_REQUESTED,
  INNGEST_EVENT_BACKGROUND_PROCESS_REQUESTED,
} from "@/lib/inngest/events";

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

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  return TRUE_VALUES.has(value.trim().toLowerCase());
}

function isInngestBackgroundTriggerEnabled(): boolean {
  return parseBoolean(process.env.BACKGROUND_JOBS_USE_INNGEST);
}

function serializeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function runInlineBackgroundCycle() {
  // Intentionally avoid session advisory locks here:
  // this route uses pooled connections and session locks can become orphaned.
  // Per-job row locking in processBackgroundJobs() already prevents double processing.
  const results = await processBackgroundJobs();
  const maintenance = await runBackgroundMaintenance({ dueNowCount: results.remaining });
  return {
    ...results,
    ...maintenance,
  };
}

export async function GET(request: NextRequest) {
  return withAiTelemetrySource(request.nextUrl.pathname, async () => {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      if (isInngestBackgroundTriggerEnabled()) {
        const requestedAt = new Date().toISOString();
        try {
          await inngest.send([
            {
              name: INNGEST_EVENT_BACKGROUND_PROCESS_REQUESTED,
              data: {
                source: "cron/background-jobs",
                requestedAt,
              },
            },
            {
              name: INNGEST_EVENT_BACKGROUND_MAINTENANCE_REQUESTED,
              data: {
                source: "cron/background-jobs",
                requestedAt,
              },
            },
          ]);

          return NextResponse.json(
            {
              success: true,
              mode: "inngest",
              enqueued: true,
              enqueuedEvents: [
                INNGEST_EVENT_BACKGROUND_PROCESS_REQUESTED,
                INNGEST_EVENT_BACKGROUND_MAINTENANCE_REQUESTED,
              ],
              requestedAt,
              timestamp: requestedAt,
            },
            { status: 202 }
          );
        } catch (enqueueError) {
          console.error("[Cron] Inngest enqueue failed, falling back to inline processing", {
            error: serializeError(enqueueError),
          });

          const fallbackResults = await runInlineBackgroundCycle();
          return NextResponse.json({
            success: true,
            mode: "inline-fallback",
            enqueued: false,
            enqueueError: serializeError(enqueueError),
            requestedAt,
            ...fallbackResults,
            timestamp: new Date().toISOString(),
          });
        }
      }

      const results = await runInlineBackgroundCycle();
      return NextResponse.json({
        success: true,
        mode: "inline",
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
    }
  });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
