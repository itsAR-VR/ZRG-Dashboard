import { NextRequest, NextResponse } from "next/server";
import { processFollowUpsDue } from "@/lib/followup-engine";

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

    console.log("[Cron] Processing follow-ups...");
    const results = await processFollowUpsDue();
    console.log("[Cron] Follow-up processing complete:", results);

    return NextResponse.json({
      success: true,
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

    console.log("[Cron] Processing follow-ups (POST)...");
    const results = await processFollowUpsDue();
    console.log("[Cron] Follow-up processing complete:", results);

    return NextResponse.json({
      success: true,
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
