import { NextRequest, NextResponse } from "next/server";

import { getResponseTimingAnalytics } from "@/actions/response-timing-analytics-actions";
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
    return readApiDisabledResponse({ endpoint: "response-timing", requestId, clientId });
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
  const channel = searchParams.get("channel");
  const responder = searchParams.get("responder");
  const attributionWindowDays = searchParams.get("attributionWindowDays");
  const maturityBufferDays = searchParams.get("maturityBufferDays");
  const topRespondersLimit = searchParams.get("topRespondersLimit");
  const cacheVersion = await getAnalyticsCacheVersion(clientId);
  const cacheKey = buildAnalyticsRouteCacheKey({
    userId: authUser.id,
    clientId,
    endpoint: "response-timing",
    params: {
      from,
      to,
      channel,
      responder,
      attributionWindowDays,
      maturityBufferDays,
      topRespondersLimit,
    },
    version: cacheVersion,
  });

  const cached = await readAnalyticsRouteCache<
    Awaited<ReturnType<typeof getResponseTimingAnalytics>>
  >(cacheKey);
  if (cached) {
    const response = NextResponse.json(cached, { status: 200 });
    response.headers.set("x-zrg-cache", "hit");
    return attachReadApiHeaders(attachAnalyticsTimingHeader(response, startedAtMs), {
      cacheControl: "private, max-age=120, stale-while-revalidate=300",
      requestId,
    });
  }

  const result = await getResponseTimingAnalytics({
    clientId,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(channel ? { channel } : {}),
    ...(responder ? { responder } : {}),
    ...(attributionWindowDays ? { attributionWindowDays: Number(attributionWindowDays) } : {}),
    ...(maturityBufferDays ? { maturityBufferDays: Number(maturityBufferDays) } : {}),
    ...(topRespondersLimit ? { topRespondersLimit: Number(topRespondersLimit) } : {}),
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
  return attachReadApiHeaders(attachAnalyticsTimingHeader(response, startedAtMs), {
    cacheControl: "private, max-age=120, stale-while-revalidate=300",
    requestId,
  });
}
