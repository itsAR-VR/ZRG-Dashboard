import { NextRequest, NextResponse } from "next/server";

import { getInboxCounts } from "@/actions/lead-actions";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("clientId");
  const counts = await getInboxCounts(clientId);

  const response = NextResponse.json({ success: true, counts }, { status: 200 });
  response.headers.set("Cache-Control", "private, max-age=0, must-revalidate");
  return response;
}
