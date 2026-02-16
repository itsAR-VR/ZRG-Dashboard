import { NextRequest, NextResponse } from "next/server";

import { getAnalytics } from "@/actions/analytics-actions";
import { isAnalyticsReadApiEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

function mapAnalyticsErrorToStatus(error: string | undefined): number {
  const message = (error || "").trim();
  if (message === "Not authenticated") return 401;
  if (message === "Unauthorized") return 403;
  return 500;
}

export async function GET(request: NextRequest) {
  if (!isAnalyticsReadApiEnabled()) {
    const response = NextResponse.json(
      { success: false, error: "READ_API_DISABLED" },
      { status: 503 }
    );
    response.headers.set("x-zrg-read-api-enabled", "0");
    response.headers.set("Cache-Control", "private, max-age=0, must-revalidate");
    return response;
  }

  const searchParams = request.nextUrl.searchParams;
  const clientId = searchParams.get("clientId") || null;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const forceRefresh = searchParams.get("forceRefresh") === "true";

  const window = from && to ? { from, to } : undefined;
  const result = await getAnalytics(clientId, { window, forceRefresh });

  if (!result.success) {
    return NextResponse.json(result, { status: mapAnalyticsErrorToStatus(result.error) });
  }

  const response = NextResponse.json(result, { status: 200 });
  response.headers.set("x-zrg-read-api-enabled", "1");
  response.headers.set("Cache-Control", "private, max-age=0, must-revalidate");
  return response;
}
