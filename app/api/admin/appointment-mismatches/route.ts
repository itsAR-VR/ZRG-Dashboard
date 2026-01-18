import { NextRequest, NextResponse } from "next/server";
import {
  generateMismatchReport,
  getMismatchCounts,
  autoCorrectMismatches,
} from "@/lib/appointment-mismatch-report";

/**
 * Admin-only endpoint for appointment mismatch reporting.
 * Requires ADMIN_API_KEY for authentication.
 *
 * GET /api/admin/appointment-mismatches
 *   Returns mismatch report with counts and records
 *   Query params:
 *   - clientId: Filter to specific workspace
 *   - limitPerType: Max records per mismatch type (default: 100)
 *   - countsOnly: If "true", return only counts (faster)
 *
 * POST /api/admin/appointment-mismatches
 *   Auto-correct mismatches
 *   Query params:
 *   - clientId: Filter to specific workspace
 *   - limitPerType: Max records per mismatch type (default: 100)
 */

function isAuthorized(request: NextRequest): boolean {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) return false;

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return false;

  // Support both Bearer token and x-api-key header
  if (authHeader === `Bearer ${adminKey}`) return true;
  if (request.headers.get("x-api-key") === adminKey) return true;

  return false;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const clientId = searchParams.get("clientId") || undefined;
    const limitPerType = parseInt(searchParams.get("limitPerType") || "100", 10) || 100;
    const countsOnly = searchParams.get("countsOnly") === "true";

    if (countsOnly) {
      const counts = await getMismatchCounts({ clientId });
      return NextResponse.json({
        success: true,
        counts,
        total: counts.sentiment_booked_no_evidence + counts.evidence_exists_not_booked + counts.canceled_but_booked_status,
        timestamp: new Date().toISOString(),
      });
    }

    const report = await generateMismatchReport({ clientId, limitPerType });
    return NextResponse.json({
      success: true,
      report,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Mismatch Report] Error generating report:", error);
    return NextResponse.json(
      {
        error: "Failed to generate mismatch report",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const clientId = searchParams.get("clientId") || undefined;
    const limitPerType = parseInt(searchParams.get("limitPerType") || "100", 10) || 100;

    console.log("[Mismatch Auto-Correct] Starting auto-correction...", { clientId, limitPerType });

    const result = await autoCorrectMismatches({ clientId, limitPerType });

    console.log("[Mismatch Auto-Correct] Completed:", result);

    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Mismatch Auto-Correct] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to auto-correct mismatches",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
