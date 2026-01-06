import { NextRequest, NextResponse } from "next/server";
import { refreshSenderEmailSnapshotsDue, resolveReactivationEnrollmentsDue, processReactivationSendsDue } from "@/lib/reactivation-engine";

function isAuthorized(request: NextRequest): boolean {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) return false;
  const authHeader = request.headers.get("Authorization");
  const legacySecret = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${expectedSecret}` || legacySecret === expectedSecret;
}

export async function GET(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    console.warn("[Reactivations Cron] CRON_SECRET not configured - endpoint disabled");
    return NextResponse.json({ error: "Cron endpoint not configured" }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    console.warn("[Reactivations Cron] Invalid authorization attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const snapshots = await refreshSenderEmailSnapshotsDue({ ttlMinutes: 60, limitClients: 50 });
    const resolved = await resolveReactivationEnrollmentsDue({ limit: 500, senderSnapshotTtlMinutes: 60 });
    const sent = await processReactivationSendsDue({ limit: 100 });

    return NextResponse.json({
      success: true,
      snapshots,
      resolved,
      sent,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Reactivations Cron] Error:", error);
    return NextResponse.json(
      { error: "Failed to process reactivations", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // Alias for manual triggers/external cron services.
  return GET(request);
}

