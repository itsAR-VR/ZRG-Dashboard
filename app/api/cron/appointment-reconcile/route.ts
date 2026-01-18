import { NextRequest, NextResponse } from "next/server";
import { runAppointmentReconciliation } from "@/lib/appointment-reconcile-runner";
import { APPOINTMENT_SOURCE } from "@/lib/meeting-lifecycle";

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

  try {
    const searchParams = request.nextUrl.searchParams;

    const workspaceLimit = Math.max(1, parseInt(searchParams.get("workspaceLimit") || process.env.RECONCILE_WORKSPACE_LIMIT || "10", 10) || 10);
    const leadsPerWorkspace = Math.max(1, parseInt(searchParams.get("leadsPerWorkspace") || process.env.RECONCILE_LEADS_PER_WORKSPACE || "50", 10) || 50);
    const staleDays = Math.max(1, parseInt(searchParams.get("staleDays") || process.env.RECONCILE_STALE_DAYS || "7", 10) || 7);
    const clientId = searchParams.get("clientId") || undefined;
    const dryRun = searchParams.get("dryRun") === "true";

    console.log("[Appointment Reconcile Cron] Starting reconciliation...", {
      workspaceLimit,
      leadsPerWorkspace,
      staleDays,
      clientId: clientId || "all",
      dryRun,
    });

    const result = await runAppointmentReconciliation({
      workspaceLimit,
      leadsPerWorkspace,
      staleDays,
      clientId,
      dryRun,
      source: APPOINTMENT_SOURCE.RECONCILE_CRON,
    });

    console.log("[Appointment Reconcile Cron] Completed:", result);

    return NextResponse.json({
      success: true,
      ...result,
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
