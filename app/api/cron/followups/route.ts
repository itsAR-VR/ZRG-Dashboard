import { NextRequest, NextResponse } from "next/server";
import { processFollowUpsDue } from "@/lib/followup-engine";

/**
 * POST /api/cron/followups
 * 
 * Processes all due follow-up instances.
 * This endpoint should be called by an external cron service (e.g., cron-job.org, Upstash)
 * 
 * Security: Requires CRON_SECRET header to match environment variable
 */
export async function POST(request: NextRequest) {
  try {
    // Verify cron secret
    const cronSecret = request.headers.get("x-cron-secret");
    const expectedSecret = process.env.CRON_SECRET;

    if (!expectedSecret) {
      console.warn("CRON_SECRET not configured - endpoint disabled");
      return NextResponse.json(
        { error: "Cron endpoint not configured" },
        { status: 503 }
      );
    }

    if (cronSecret !== expectedSecret) {
      console.warn("Invalid cron secret attempt");
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
 * GET /api/cron/followups
 * 
 * Health check endpoint for the cron job
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/cron/followups",
    method: "POST",
    description: "Process due follow-up instances",
    timestamp: new Date().toISOString(),
  });
}
