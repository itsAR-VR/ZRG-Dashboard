import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { withAiTelemetrySource } from "@/lib/ai/telemetry-context";
import {
  buildBackgroundDispatchEventIds,
  computeBackgroundDispatchWindow,
  getBackgroundDispatchWindowSeconds,
} from "@/lib/background-jobs/dispatch";
import {
  markBackgroundDispatchEnqueued,
  markBackgroundDispatchFailed,
  markBackgroundDispatchInlineEmergency,
  recoverStaleBackgroundFunctionRuns,
  registerBackgroundDispatchWindow,
} from "@/lib/background-jobs/dispatch-ledger";
import { runBackgroundMaintenance } from "@/lib/background-jobs/maintenance";
import { processBackgroundJobs } from "@/lib/background-jobs/runner";
import { inngest } from "@/lib/inngest/client";
import {
  BackgroundDispatchEventData,
  INNGEST_EVENT_BACKGROUND_MAINTENANCE_REQUESTED,
  INNGEST_EVENT_BACKGROUND_PROCESS_REQUESTED,
} from "@/lib/inngest/events";

// Vercel Serverless Functions (Pro) require maxDuration in [1, 800].
export const maxDuration = 800;
const BACKGROUND_DISPATCH_SOURCE = "cron/background-jobs";

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
  const explicit = process.env.BACKGROUND_JOBS_USE_INNGEST;
  if (explicit && explicit.trim().length > 0) {
    return parseBoolean(explicit);
  }

  return Boolean(process.env.INNGEST_EVENT_KEY?.trim());
}

function isInlineEmergencyFallbackEnabled(): boolean {
  return parseBoolean(process.env.BACKGROUND_JOBS_INLINE_EMERGENCY_FALLBACK);
}

function isForceInlineModeEnabled(): boolean {
  return parseBoolean(process.env.BACKGROUND_JOBS_FORCE_INLINE);
}

function isInlineFallbackOnStaleRunEnabled(): boolean {
  const explicit = process.env.BACKGROUND_JOBS_INLINE_ON_STALE_RUN;
  if (!explicit || explicit.trim().length === 0) {
    return true;
  }
  return parseBoolean(explicit);
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

type DispatchContext = {
  dispatchData: BackgroundDispatchEventData;
  requestedAt: string;
};

function buildDispatchContext(): DispatchContext {
  const requestedAtDate = new Date();
  const requestedAt = requestedAtDate.toISOString();
  const dispatchWindow = computeBackgroundDispatchWindow(requestedAtDate, getBackgroundDispatchWindowSeconds());

  return {
    requestedAt,
    dispatchData: {
      source: BACKGROUND_DISPATCH_SOURCE,
      requestedAt,
      dispatchKey: dispatchWindow.dispatchKey,
      correlationId: crypto.randomUUID(),
      dispatchWindowStart: dispatchWindow.windowStart.toISOString(),
      dispatchWindowSeconds: dispatchWindow.windowSeconds,
    },
  };
}

export async function GET(request: NextRequest) {
  return withAiTelemetrySource(request.nextUrl.pathname, async () => {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const { requestedAt, dispatchData } = buildDispatchContext();

      if (isForceInlineModeEnabled()) {
        const results = await runInlineBackgroundCycle();
        return NextResponse.json({
          success: true,
          mode: "inline-forced",
          enqueued: false,
          dispatch: dispatchData,
          ...results,
          timestamp: new Date().toISOString(),
        });
      }

      if (isInngestBackgroundTriggerEnabled()) {
        const staleRecovery = await recoverStaleBackgroundFunctionRuns({
          functionName: "process-background-jobs",
        });

        if (staleRecovery.recovered > 0 && isInlineFallbackOnStaleRunEnabled()) {
          console.error("[Cron] Stale process-background-jobs runs detected; using inline recovery", {
            recovered: staleRecovery.recovered,
            staleMinutes: staleRecovery.staleMinutes,
            runKeys: staleRecovery.runKeys.slice(0, 5),
            oldestStartedAt: staleRecovery.oldestStartedAt,
          });

          const inlineResults = await runInlineBackgroundCycle();
          return NextResponse.json({
            success: true,
            mode: "inline-stale-run-recovery",
            enqueued: false,
            dispatch: dispatchData,
            staleRecovery,
            ...inlineResults,
            timestamp: new Date().toISOString(),
          });
        }

        const dispatchIds = buildBackgroundDispatchEventIds(dispatchData.dispatchKey);
        const registration = await registerBackgroundDispatchWindow({
          dispatchKey: dispatchData.dispatchKey,
          source: dispatchData.source,
          requestedAt: dispatchData.requestedAt,
          windowStart: dispatchData.dispatchWindowStart,
          windowSeconds: dispatchData.dispatchWindowSeconds,
          correlationId: dispatchData.correlationId,
        });

        if (registration.duplicateSuppressed) {
          return NextResponse.json({
            success: true,
            mode: "dispatch-duplicate-suppressed",
            enqueued: false,
            dispatch: dispatchData,
            dispatchIds,
            existingDispatch: registration.existing ?? null,
            trackingEnabled: registration.trackingEnabled,
            timestamp: new Date().toISOString(),
          });
        }

        try {
          const sendResult = await inngest.send([
            {
              id: dispatchIds.processDispatchId,
              name: INNGEST_EVENT_BACKGROUND_PROCESS_REQUESTED,
              data: dispatchData,
            },
            {
              id: dispatchIds.maintenanceDispatchId,
              name: INNGEST_EVENT_BACKGROUND_MAINTENANCE_REQUESTED,
              data: dispatchData,
            },
          ]);
          const publishedEventIds = Array.isArray(sendResult?.ids) ? sendResult.ids : [];

          await markBackgroundDispatchEnqueued({
            dispatchKey: dispatchData.dispatchKey,
            processDispatchId: dispatchIds.processDispatchId,
            maintenanceDispatchId: dispatchIds.maintenanceDispatchId,
            processEventId: publishedEventIds[0],
            maintenanceEventId: publishedEventIds[1],
          });

          return NextResponse.json(
            {
              success: true,
              mode: "dispatch-only",
              enqueued: true,
            enqueuedEvents: [
                INNGEST_EVENT_BACKGROUND_PROCESS_REQUESTED,
                INNGEST_EVENT_BACKGROUND_MAINTENANCE_REQUESTED,
              ],
              dispatch: dispatchData,
              staleRecovery,
              dispatchIds,
              publishedEventIds,
              trackingEnabled: registration.trackingEnabled,
              requestedAt,
              timestamp: requestedAt,
            },
            { status: 202 }
          );
        } catch (enqueueError) {
          const enqueueErrorMessage = serializeError(enqueueError);
          await markBackgroundDispatchFailed({
            dispatchKey: dispatchData.dispatchKey,
            processDispatchId: dispatchIds.processDispatchId,
            maintenanceDispatchId: dispatchIds.maintenanceDispatchId,
            errorMessage: enqueueErrorMessage,
          });

          if (!isInlineEmergencyFallbackEnabled()) {
            console.error("[Cron] Inngest enqueue failed (dispatch-only mode)", {
              error: enqueueErrorMessage,
              dispatchKey: dispatchData.dispatchKey,
              correlationId: dispatchData.correlationId,
            });
            return NextResponse.json(
              {
                success: false,
                mode: "dispatch-failed",
                enqueued: false,
                retryable: true,
                enqueueError: enqueueErrorMessage,
                dispatch: dispatchData,
                staleRecovery,
                dispatchIds,
                trackingEnabled: registration.trackingEnabled,
                timestamp: new Date().toISOString(),
              },
              { status: 503 }
            );
          }

          console.error("[Cron] Inngest enqueue failed; emergency inline fallback enabled", {
            error: enqueueErrorMessage,
            dispatchKey: dispatchData.dispatchKey,
            correlationId: dispatchData.correlationId,
          });

          const fallbackResults = await runInlineBackgroundCycle();
          await markBackgroundDispatchInlineEmergency({
            dispatchKey: dispatchData.dispatchKey,
            processDispatchId: dispatchIds.processDispatchId,
            maintenanceDispatchId: dispatchIds.maintenanceDispatchId,
            errorMessage: enqueueErrorMessage,
          });

          return NextResponse.json({
            success: true,
            mode: "inline-emergency-fallback",
            enqueued: false,
            enqueueError: enqueueErrorMessage,
            dispatch: dispatchData,
            staleRecovery,
            dispatchIds,
            trackingEnabled: registration.trackingEnabled,
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
