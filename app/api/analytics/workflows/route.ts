import { NextRequest, NextResponse } from "next/server";

import { getWorkflowAttributionAnalytics } from "@/actions/analytics-actions";
import { isAnalyticsReadApiEnabled } from "@/lib/feature-flags";
import { requireAuthUser } from "@/lib/workspace-access";
import {
  attachAnalyticsTimingHeader,
  attachReadApiHeaders,
  buildAnalyticsRouteCacheKey,
  getAnalyticsCacheVersion,
  mapAnalyticsErrorToStatus,
  readAnalyticsRouteCache,
  readApiDisabledResponse,
  writeAnalyticsRouteCache,
} from "@/app/api/analytics/_helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const startedAtMs = Date.now();

  if (!isAnalyticsReadApiEnabled()) {
    return readApiDisabledResponse();
  }

  let authUser: Awaited<ReturnType<typeof requireAuthUser>>;
  try {
    authUser = await requireAuthUser();
  } catch {
    return NextResponse.json(
      { success: false, error: "Not authenticated" },
      { status: 401 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const clientId = searchParams.get("clientId") || null;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const cacheVersion = await getAnalyticsCacheVersion(clientId);
  const cacheKey = buildAnalyticsRouteCacheKey({
    userId: authUser.id,
    clientId,
    endpoint: "workflows",
    params: { from, to },
    version: cacheVersion,
  });

  const cached = await readAnalyticsRouteCache<
    Awaited<ReturnType<typeof getWorkflowAttributionAnalytics>>
  >(cacheKey);
  if (cached) {
    const response = NextResponse.json(cached, { status: 200 });
    response.headers.set("x-zrg-cache", "hit");
    return attachReadApiHeaders(attachAnalyticsTimingHeader(response, startedAtMs), {
      cacheControl: "private, max-age=120, stale-while-revalidate=300",
    });
  }

  const result = await getWorkflowAttributionAnalytics({
    clientId,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });

  if (!result.success) {
    return NextResponse.json(result, { status: mapAnalyticsErrorToStatus(result.error) });
  }

  await writeAnalyticsRouteCache(cacheKey, result, 120);
  const response = NextResponse.json(result, { status: 200 });
  response.headers.set("x-zrg-cache", "miss");
  return attachReadApiHeaders(attachAnalyticsTimingHeader(response, startedAtMs), {
    cacheControl: "private, max-age=120, stale-while-revalidate=300",
  });
}
