import { NextRequest, NextResponse } from "next/server";

import { getConversation, type Channel } from "@/actions/lead-actions";
import { isInboxReadApiEnabled } from "@/lib/feature-flags";
import { requireAuthUser } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";
const READ_API_FAIL_OPEN_HEADER = "x-zrg-read-api-fail-open";
const READ_API_FAIL_OPEN_REASON = "server_action_unavailable";
const READ_API_DISABLED_REASON = "disabled_by_flag";

function resolveRequestId(raw: string | null): string {
  const trimmed = (raw || "").trim();
  if (trimmed) return trimmed.slice(0, 128);
  return crypto.randomUUID();
}

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

function shouldFailOpenReadApi(request: NextRequest): boolean {
  return request.headers.get(READ_API_FAIL_OPEN_HEADER) === READ_API_FAIL_OPEN_REASON;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const startedAt = Date.now();
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  if (!isInboxReadApiEnabled() && !shouldFailOpenReadApi(request)) {
    console.warn(
      "[Read API] disabled",
      JSON.stringify({
        area: "inbox",
        endpoint: "conversations/[leadId]",
        requestId,
        reason: READ_API_DISABLED_REASON,
      })
    );
    const response = NextResponse.json(
      { success: false, error: "READ_API_DISABLED" },
      { status: 503 }
    );
    response.headers.set("x-zrg-read-api-enabled", "0");
    response.headers.set("x-zrg-read-api-reason", READ_API_DISABLED_REASON);
    response.headers.set("x-request-id", requestId);
    response.headers.set("x-zrg-duration-ms", String(Date.now() - startedAt));
    response.headers.set("Cache-Control", "private, max-age=0, must-revalidate");
    return response;
  }

  let authUser: Awaited<ReturnType<typeof requireAuthUser>>;
  try {
    authUser = await requireAuthUser();
  } catch {
    const response = NextResponse.json(
      { success: false, error: "Not authenticated" },
      { status: 401 }
    );
    response.headers.set("x-request-id", requestId);
    response.headers.set("x-zrg-duration-ms", String(Date.now() - startedAt));
    return response;
  }

  const { leadId } = await params;
  if (!leadId) {
    const response = NextResponse.json({ success: false, error: "Lead ID is required" }, { status: 400 });
    response.headers.set("x-request-id", requestId);
    response.headers.set("x-zrg-duration-ms", String(Date.now() - startedAt));
    return response;
  }

  const channelFilter = normalizeChannel(request.nextUrl.searchParams.get("channel"));
  const result = await getConversation(leadId, channelFilter, { authUser });
  if (!result.success) {
    const response = NextResponse.json(result, { status: mapConversationErrorToStatus(result.error) });
    response.headers.set("x-request-id", requestId);
    response.headers.set("x-zrg-duration-ms", String(Date.now() - startedAt));
    return response;
  }

  const response = NextResponse.json(result, { status: 200 });
  response.headers.set("x-zrg-read-api-enabled", "1");
  response.headers.set("x-request-id", requestId);
  response.headers.set("x-zrg-duration-ms", String(Date.now() - startedAt));
  response.headers.set("Cache-Control", "private, max-age=0, must-revalidate");
  return response;
}
