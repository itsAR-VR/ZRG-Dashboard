import { NextRequest, NextResponse } from "next/server";

import { getAnalytics } from "@/actions/analytics-actions";
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
  resolveRequestId,
  writeAnalyticsRouteCache,
} from "@/app/api/analytics/_helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const startedAtMs = Date.now();
  const searchParams = request.nextUrl.searchParams;
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  const clientId = searchParams.get("clientId") || null;

  if (!isAnalyticsReadApiEnabled()) {
    return readApiDisabledResponse({ endpoint: "overview", requestId, clientId });
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
    return response;
  }

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const partsRaw = (searchParams.get("parts") || "all").trim().toLowerCase();
  const parts = partsRaw === "core" || partsRaw === "breakdowns" ? partsRaw : "all";
  const forceRefresh = searchParams.get("forceRefresh") === "true";

  const window = from && to ? { from, to } : undefined;
  const cacheVersion = await getAnalyticsCacheVersion(clientId);
  const cacheKey = buildAnalyticsRouteCacheKey({
    userId: authUser.id,
    clientId,
    endpoint: "overview",
    params: { from, to, parts },
    version: cacheVersion,
  });

  if (!forceRefresh) {
    const cached = await readAnalyticsRouteCache<
      Awaited<ReturnType<typeof getAnalytics>>
    >(cacheKey);
    if (cached) {
      const response = NextResponse.json(cached, { status: 200 });
      response.headers.set("x-zrg-cache", "hit");
      response.headers.set("x-zrg-analytics-parts", parts);
      return attachReadApiHeaders(attachAnalyticsTimingHeader(response, startedAtMs), {
        cacheControl: "private, max-age=120, stale-while-revalidate=300",
        requestId,
      });
    }
  }

  const result = await getAnalytics(clientId, {
    window,
    // Route cache is the source of truth for this endpoint; bypass the
    // action-level cache on route misses to avoid redundant cache layers.
    forceRefresh: true,
    parts,
    authUser,
  });

  if (!result.success) {
    const response = NextResponse.json(result, { status: mapAnalyticsErrorToStatus(result.error) });
    response.headers.set("x-request-id", requestId);
    return response;
  }

  await writeAnalyticsRouteCache(cacheKey, result, 120);
  const response = NextResponse.json(result, { status: 200 });
  response.headers.set("x-zrg-cache", "miss");
  response.headers.set("x-zrg-analytics-parts", parts);
  return attachReadApiHeaders(attachAnalyticsTimingHeader(response, startedAtMs), {
    cacheControl: "private, max-age=120, stale-while-revalidate=300",
    requestId,
  });
}
