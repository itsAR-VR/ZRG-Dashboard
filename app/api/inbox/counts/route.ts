import { NextRequest, NextResponse } from "next/server";

import { getInboxCounts } from "@/actions/lead-actions";
import { isInboxReadApiEnabled } from "@/lib/feature-flags";
import { requireAuthUser } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";
// Keep parity with conversations read API runtime headroom on large workspaces.
export const maxDuration = 800;
const READ_API_FAIL_OPEN_HEADER = "x-zrg-read-api-fail-open";
const READ_API_FAIL_OPEN_REASON = "server_action_unavailable";
const READ_API_DISABLED_REASON = "disabled_by_flag";

function resolveRequestId(raw: string | null): string {
  const trimmed = (raw || "").trim();
  if (trimmed) return trimmed.slice(0, 128);
  return crypto.randomUUID();
}

function shouldFailOpenReadApi(request: NextRequest): boolean {
  return request.headers.get(READ_API_FAIL_OPEN_HEADER) === READ_API_FAIL_OPEN_REASON;
}

function mapActionErrorToStatus(error: string | undefined): number {
  const message = (error || "").trim();
  if (message === "Not authenticated" || message.startsWith("Not authenticated")) return 401;
  if (message === "Unauthorized" || message.startsWith("Unauthorized")) return 403;
  return 500;
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  const clientId = request.nextUrl.searchParams.get("clientId");

  if (!isInboxReadApiEnabled() && !shouldFailOpenReadApi(request)) {
    console.warn(
      "[Read API] disabled",
      JSON.stringify({
        area: "inbox",
        endpoint: "counts",
        requestId,
        clientId: (clientId || "").trim() || null,
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

  let counts: Awaited<ReturnType<typeof getInboxCounts>>;
  try {
    counts = await getInboxCounts(clientId, { authUser, throwOnAuthError: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load inbox counts";
    const response = NextResponse.json(
      { success: false, error: message },
      { status: mapActionErrorToStatus(message) }
    );
    response.headers.set("x-request-id", requestId);
    response.headers.set("x-zrg-duration-ms", String(Date.now() - startedAt));
    return response;
  }

  const response = NextResponse.json({ success: true, counts }, { status: 200 });
  response.headers.set("x-zrg-read-api-enabled", "1");
  response.headers.set("x-request-id", requestId);
  response.headers.set("x-zrg-duration-ms", String(Date.now() - startedAt));
  response.headers.set("Cache-Control", "private, max-age=0, must-revalidate");
  return response;
}
