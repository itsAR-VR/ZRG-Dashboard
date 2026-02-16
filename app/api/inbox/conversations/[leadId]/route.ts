import { NextRequest, NextResponse } from "next/server";

import { getConversation, type Channel } from "@/actions/lead-actions";
import { isInboxReadApiEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ leadId: string }>;
}

function normalizeChannel(raw: string | null): Channel | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "sms") return "sms";
  if (trimmed === "email") return "email";
  if (trimmed === "linkedin") return "linkedin";
  return undefined;
}

function mapConversationErrorToStatus(error: string | undefined): number {
  const message = (error || "").trim();
  if (!message) return 500;
  if (message === "Not authenticated") return 401;
  if (message === "Unauthorized") return 403;
  if (message === "Lead not found") return 404;
  return 500;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!isInboxReadApiEnabled()) {
    const response = NextResponse.json(
      { success: false, error: "READ_API_DISABLED" },
      { status: 503 }
    );
    response.headers.set("x-zrg-read-api-enabled", "0");
    response.headers.set("Cache-Control", "private, max-age=0, must-revalidate");
    return response;
  }

  const { leadId } = await params;
  if (!leadId) {
    return NextResponse.json({ success: false, error: "Lead ID is required" }, { status: 400 });
  }

  const channelFilter = normalizeChannel(request.nextUrl.searchParams.get("channel"));
  const result = await getConversation(leadId, channelFilter);
  if (!result.success) {
    return NextResponse.json(result, { status: mapConversationErrorToStatus(result.error) });
  }

  const response = NextResponse.json(result, { status: 200 });
  response.headers.set("x-zrg-read-api-enabled", "1");
  response.headers.set("Cache-Control", "private, max-age=0, must-revalidate");
  return response;
}
