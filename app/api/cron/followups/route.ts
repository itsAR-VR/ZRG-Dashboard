import { NextRequest, NextResponse } from "next/server";
import {
  processFollowUpsDue,
  resumeAwaitingEnrichmentFollowUps,
  resumeGhostedFollowUps,
  resumeSnoozedFollowUps,
} from "@/lib/followup-engine";
import { refreshAvailabilityCachesDue } from "@/lib/availability-cache";
import { backfillNoResponseFollowUpsDueOnCron } from "@/lib/followup-backfill";

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

    console.log("[Cron] Refreshing availability caches...");
    const availability = await refreshAvailabilityCachesDue({ limit: 50 });
    console.log("[Cron] Availability refresh complete:", availability);

    console.log("[Cron] Resuming snoozed follow-ups...");
    const snoozed = await resumeSnoozedFollowUps({ limit: 200 });
    console.log("[Cron] Snoozed follow-up resume complete:", snoozed);

    console.log("[Cron] Resuming ghosted follow-ups...");
    const resumed = await resumeGhostedFollowUps({ days: 7, limit: 100 });
    console.log("[Cron] Ghosted follow-up resume complete:", resumed);

    console.log("[Cron] Resuming enrichment-paused follow-ups...");
    const enrichmentResumed = await resumeAwaitingEnrichmentFollowUps({ limit: 200 });
    console.log("[Cron] Enrichment-paused follow-up resume complete:", enrichmentResumed);

    console.log("[Cron] Backfilling awaiting-reply follow-ups...");
    const backfill = await backfillNoResponseFollowUpsDueOnCron();
    console.log("[Cron] Follow-up backfill complete:", backfill);

    console.log("[Cron] Processing follow-ups...");
    const results = await processFollowUpsDue();
    console.log("[Cron] Follow-up processing complete:", results);

    return NextResponse.json({
      success: true,
      availability,
      snoozed,
      resumed,
      enrichmentResumed,
      backfill,
      results,
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
}

/**
 * POST /api/cron/followups
 * 
 * Alternative endpoint for manual triggering or external cron services
 * Uses x-cron-secret header for backwards compatibility
 */
export async function POST(request: NextRequest) {
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

    console.log("[Cron] Refreshing availability caches (POST)...");
    const availability = await refreshAvailabilityCachesDue({ limit: 50 });
    console.log("[Cron] Availability refresh complete:", availability);

    console.log("[Cron] Resuming snoozed follow-ups (POST)...");
    const snoozed = await resumeSnoozedFollowUps({ limit: 200 });
    console.log("[Cron] Snoozed follow-up resume complete:", snoozed);

    console.log("[Cron] Resuming ghosted follow-ups (POST)...");
    const resumed = await resumeGhostedFollowUps({ days: 7, limit: 100 });
    console.log("[Cron] Ghosted follow-up resume complete:", resumed);

    console.log("[Cron] Resuming enrichment-paused follow-ups (POST)...");
    const enrichmentResumed = await resumeAwaitingEnrichmentFollowUps({ limit: 200 });
    console.log("[Cron] Enrichment-paused follow-up resume complete:", enrichmentResumed);

    console.log("[Cron] Backfilling awaiting-reply follow-ups (POST)...");
    const backfill = await backfillNoResponseFollowUpsDueOnCron();
    console.log("[Cron] Follow-up backfill complete:", backfill);

    console.log("[Cron] Processing follow-ups (POST)...");
    const results = await processFollowUpsDue();
    console.log("[Cron] Follow-up processing complete:", results);

    return NextResponse.json({
      success: true,
      availability,
      snoozed,
      resumed,
      enrichmentResumed,
      backfill,
      results,
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
}
