import { NextRequest, NextResponse } from "next/server";

import { getInboxCounts } from "@/actions/lead-actions";
import { isInboxReadApiEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";
const READ_API_FAIL_OPEN_HEADER = "x-zrg-read-api-fail-open";
const READ_API_FAIL_OPEN_REASON = "server_action_unavailable";

function shouldFailOpenReadApi(request: NextRequest): boolean {
  return request.headers.get(READ_API_FAIL_OPEN_HEADER) === READ_API_FAIL_OPEN_REASON;
}

export async function GET(request: NextRequest) {
  if (!isInboxReadApiEnabled() && !shouldFailOpenReadApi(request)) {
    const response = NextResponse.json(
      { success: false, error: "READ_API_DISABLED" },
      { status: 503 }
    );
    response.headers.set("x-zrg-read-api-enabled", "0");
    response.headers.set("Cache-Control", "private, max-age=0, must-revalidate");
    return response;
  }

  const clientId = request.nextUrl.searchParams.get("clientId");
  const counts = await getInboxCounts(clientId);

  const response = NextResponse.json({ success: true, counts }, { status: 200 });
  response.headers.set("x-zrg-read-api-enabled", "1");
  response.headers.set("Cache-Control", "private, max-age=0, must-revalidate");
  return response;
}
