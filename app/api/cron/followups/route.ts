import { NextRequest, NextResponse } from "next/server";
import {
  processFollowUpsDue,
  resumeAwaitingEnrichmentFollowUps,
  resumeGhostedFollowUps,
  resumeSnoozedFollowUps,
} from "@/lib/followup-engine";
import { backfillNoResponseFollowUpsDueOnCron } from "@/lib/followup-backfill";
import { withAiTelemetrySource } from "@/lib/ai/telemetry-context";
import { retrySmsDndHeldLeads } from "@/lib/booking-sms-dnd-retry";
import { processDailyNotificationDigestsDue } from "@/lib/notification-center";

// Vercel Serverless Functions (Pro) require maxDuration in [1, 800].
export const maxDuration = 800;

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
      return NextResponse.json(
        { error: "Cron endpoint not configured" },
        { status: 503 }
      );
    }

    if (authHeader !== `Bearer ${expectedSecret}`) {
      console.warn("[Cron] Invalid authorization attempt");
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Phase 61: Availability refresh is handled by the dedicated `/api/cron/availability` endpoint.
    // Keep follow-ups cron focused on follow-up processing (and avoid double-refresh provider load).

    console.log("[Cron] Resuming snoozed follow-ups...");
    const snoozed = await resumeSnoozedFollowUps({ limit: 200 });
    console.log("[Cron] Snoozed follow-up resume complete:", snoozed);

    console.log("[Cron] Resuming ghosted follow-ups...");
    const resumed = await resumeGhostedFollowUps({ days: 7, limit: 100 });
    console.log("[Cron] Ghosted follow-up resume complete:", resumed);

    console.log("[Cron] Resuming enrichment-paused follow-ups...");
    const enrichmentResumed = await resumeAwaitingEnrichmentFollowUps({ limit: 200 });
    console.log("[Cron] Enrichment-paused follow-up resume complete:", enrichmentResumed);

    console.log("[Cron] Retrying SMS DND held leads...");
    const smsDndRetry = await retrySmsDndHeldLeads({ limit: 50 });
    console.log("[Cron] SMS DND retry complete:", smsDndRetry);

    console.log("[Cron] Backfilling awaiting-reply follow-ups...");
    const backfill = await backfillNoResponseFollowUpsDueOnCron();
    console.log("[Cron] Follow-up backfill complete:", backfill);

    console.log("[Cron] Processing follow-ups...");
    const results = await processFollowUpsDue();
    console.log("[Cron] Follow-up processing complete:", results);

    console.log("[Cron] Processing notification digests...");
    const notificationDigests = await processDailyNotificationDigestsDue({ limit: 50 });
    console.log("[Cron] Notification digests complete:", notificationDigests);

      return NextResponse.json({
        success: true,
        snoozed,
        resumed,
        enrichmentResumed,
        smsDndRetry,
        backfill,
        results,
        notificationDigests,
        timestamp: new Date().toISOString(),
      });
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
      return NextResponse.json(
        { error: "Cron endpoint not configured" },
        { status: 503 }
      );
    }

    const isAuthorized = 
      authHeader === `Bearer ${expectedSecret}` || 
      legacySecret === expectedSecret;

    if (!isAuthorized) {
      console.warn("[Cron] Invalid authorization attempt");
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Phase 61: Availability refresh is handled by the dedicated `/api/cron/availability` endpoint.
    // Keep follow-ups cron focused on follow-up processing (and avoid double-refresh provider load).

    console.log("[Cron] Resuming snoozed follow-ups (POST)...");
    const snoozed = await resumeSnoozedFollowUps({ limit: 200 });
    console.log("[Cron] Snoozed follow-up resume complete:", snoozed);

    console.log("[Cron] Resuming ghosted follow-ups (POST)...");
    const resumed = await resumeGhostedFollowUps({ days: 7, limit: 100 });
    console.log("[Cron] Ghosted follow-up resume complete:", resumed);

    console.log("[Cron] Resuming enrichment-paused follow-ups (POST)...");
    const enrichmentResumed = await resumeAwaitingEnrichmentFollowUps({ limit: 200 });
    console.log("[Cron] Enrichment-paused follow-up resume complete:", enrichmentResumed);

    console.log("[Cron] Retrying SMS DND held leads (POST)...");
    const smsDndRetry = await retrySmsDndHeldLeads({ limit: 50 });
    console.log("[Cron] SMS DND retry complete:", smsDndRetry);

    console.log("[Cron] Backfilling awaiting-reply follow-ups (POST)...");
    const backfill = await backfillNoResponseFollowUpsDueOnCron();
    console.log("[Cron] Follow-up backfill complete:", backfill);

    console.log("[Cron] Processing follow-ups (POST)...");
    const results = await processFollowUpsDue();
    console.log("[Cron] Follow-up processing complete:", results);

    console.log("[Cron] Processing notification digests (POST)...");
    const notificationDigests = await processDailyNotificationDigestsDue({ limit: 50 });
    console.log("[Cron] Notification digests complete:", notificationDigests);

      return NextResponse.json({
        success: true,
        snoozed,
        resumed,
        enrichmentResumed,
        smsDndRetry,
        backfill,
        results,
        notificationDigests,
        timestamp: new Date().toISOString(),
      });
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
