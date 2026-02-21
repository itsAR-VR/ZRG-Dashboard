import { NextRequest, NextResponse } from "next/server";
import {
  buildAppointmentReconcileOptions,
  runAppointmentReconcileCron,
} from "@/lib/cron/appointment-reconcile";
import {
  buildCronDispatchContext,
  buildCronEventId,
  collectDispatchParams,
  isInngestConfigured,
  parseBooleanFlag,
} from "@/lib/inngest/cron-dispatch";
import { inngest } from "@/lib/inngest/client";
import { INNGEST_EVENT_CRON_APPOINTMENT_RECONCILE_REQUESTED } from "@/lib/inngest/events";

// Vercel Serverless Functions (Pro) require maxDuration in [1, 800].
export const maxDuration = 800;

const APPOINTMENT_RECONCILE_PARAM_KEYS = [
  "workspaceLimit",
  "leadsPerWorkspace",
  "staleDays",
  "clientId",
  "dryRun",
] as const;

function isDispatchEnabled(): boolean {
  return parseBooleanFlag(process.env.CRON_APPOINTMENT_RECONCILE_USE_INNGEST);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getDispatchWindowSeconds(): number {
  const parsed = parsePositiveInt(process.env.CRON_APPOINTMENT_RECONCILE_DISPATCH_WINDOW_SECONDS, 60);
  return Math.max(30, Math.min(3600, parsed));
}

/**
 * GET /api/cron/appointment-reconcile
 *
 * Reconciles appointment booking state for leads across workspaces.
 * Uses provider APIs to verify booking evidence and update lead state.
 *
 * Called automatically by Vercel Cron (configured in vercel.json)
 *
 * Security: Requires Authorization: Bearer <CRON_SECRET> header
 *
 * Query parameters:
 * - workspaceLimit: Max workspaces to process (default: 10)
 * - leadsPerWorkspace: Max leads per workspace (default: 50)
 * - staleDays: Re-check leads not checked in N days (default: 7)
 * - clientId: Only process a specific workspace
 * - dryRun: If "true", don't write to database
 */
export async function GET(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret) {
    console.warn("[Appointment Reconcile Cron] CRON_SECRET not configured - endpoint disabled");
    return NextResponse.json({ error: "Cron endpoint not configured" }, { status: 503 });
  }

  const authHeader = request.headers.get("Authorization");
  if (authHeader !== `Bearer ${expectedSecret}`) {
    console.warn("[Appointment Reconcile Cron] Invalid authorization attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;

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

    const params = collectDispatchParams(searchParams, APPOINTMENT_RECONCILE_PARAM_KEYS);
    const dispatchWindowSeconds = getDispatchWindowSeconds();
    const { requestedAt, dispatchData } = buildCronDispatchContext({
      job: "appointment-reconcile",
      source: "cron/appointment-reconcile",
      dispatchWindowSeconds,
      params,
    });
    const eventId = buildCronEventId(INNGEST_EVENT_CRON_APPOINTMENT_RECONCILE_REQUESTED, dispatchData.dispatchKey);

    try {
      const sendResult = await inngest.send({
        id: eventId,
        name: INNGEST_EVENT_CRON_APPOINTMENT_RECONCILE_REQUESTED,
        data: dispatchData,
      });
      const publishedEventIds = Array.isArray(sendResult?.ids) ? sendResult.ids : [];

      return NextResponse.json(
        {
          success: true,
          mode: "dispatch-only",
          dispatch: dispatchData,
          event: {
            name: INNGEST_EVENT_CRON_APPOINTMENT_RECONCILE_REQUESTED,
            id: eventId,
          },
          publishedEventIds,
          timestamp: requestedAt,
        },
        { status: 202 }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Appointment Reconcile Cron] Dispatch enqueue failed:", error);
      return NextResponse.json(
        {
          success: false,
          mode: "dispatch-failed",
          enqueueError: message,
          dispatch: dispatchData,
          event: {
            name: INNGEST_EVENT_CRON_APPOINTMENT_RECONCILE_REQUESTED,
            id: eventId,
          },
          timestamp: new Date().toISOString(),
        },
        { status: 503 }
      );
    }
  }

  try {
    const options = buildAppointmentReconcileOptions(searchParams);

    console.log("[Appointment Reconcile Cron] Starting reconciliation...", {
      workspaceLimit: options.workspaceLimit,
      leadsPerWorkspace: options.leadsPerWorkspace,
      staleDays: options.staleDays,
      clientId: options.clientId || "all",
      dryRun: options.dryRun,
    });

    const result = await runAppointmentReconcileCron(options);

    console.log("[Appointment Reconcile Cron] Completed:", result);

    // Phase 57d: Add health indicator for monitoring/alerting
    let health: "healthy" | "degraded" | "unhealthy" | "circuit_broken";
    if (result.circuitBroken) health = "circuit_broken";
    else if (result.errors === 0) health = "healthy";
    else if (result.errors < 5) health = "degraded";
    else health = "unhealthy";

    return NextResponse.json({
      success: true,
      ...result,
      health,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Appointment Reconcile Cron] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to run appointment reconciliation",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/cron/appointment-reconcile
 *
 * Alternative endpoint for manual triggering or external cron services.
 */
export async function POST(request: NextRequest) {
  return GET(request);
}
