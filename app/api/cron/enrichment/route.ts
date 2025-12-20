/**
 * Cron job for batch processing leads that need enrichment
 * Policy: do NOT retry Clay enrichment. This cron is cleanup-only:
 * if a lead has been "pending" for too long, mark it as failed.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { POSITIVE_SENTIMENTS } from "@/lib/sentiment";

// If Clay hasn't responded after this window, stop showing "enriching".
const PENDING_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

// Secret for cron authentication (use CRON_SECRET env var)
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.warn("[Enrichment Cron] CRON_SECRET not configured");
    return true; // Allow in development
  }

  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  // Verify cron authentication
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[Enrichment Cron] Cleanup-only job starting");

  try {
    const cutoff = new Date(Date.now() - PENDING_TIMEOUT_MS);

    // Find leads stuck enriching too long and mark failed (no retries).
    const leadsToFail = await prisma.lead.findMany({
      where: {
        enrichmentStatus: "pending",
        email: { not: null },
        sentimentTag: { in: [...POSITIVE_SENTIMENTS] },
        enrichmentLastRetry: { lte: cutoff },
      },
      take: 200,
      select: { id: true },
    });

    if (leadsToFail.length === 0) {
      console.log("[Enrichment Cron] No stale pending enrichments to clean up");
      return NextResponse.json({
        success: true,
        cleaned: 0,
        message: "No stale pending enrichments",
      });
    }

    const ids = leadsToFail.map((l) => l.id);
    const update = await prisma.lead.updateMany({
      where: { id: { in: ids }, enrichmentStatus: "pending" },
      data: { enrichmentStatus: "failed" },
    });

    console.log(`[Enrichment Cron] Marked ${update.count} stale pending enrichment(s) as failed`);

    return NextResponse.json({
      success: true,
      cleaned: update.count,
      message: `Marked ${update.count} stale pending enrichment(s) as failed`,
    });
  } catch (error) {
    console.error("[Enrichment Cron] Job failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// Manual trigger endpoint (POST)
export async function POST(request: NextRequest) {
  // Verify authentication (either cron secret or admin auth)
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // Could add additional admin auth check here
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Process same as GET but can be triggered manually
  return GET(request);
}
