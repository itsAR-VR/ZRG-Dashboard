import { NextRequest, NextResponse } from "next/server";

import {
  getCrmAssigneeOptions,
  getCrmSheetRows,
  getCrmWindowSummary,
  type CrmSheetFilters,
} from "@/actions/analytics-actions";
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

type CrmReadMode = "rows" | "summary" | "assignees";

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseCrmFilters(searchParams: URLSearchParams): CrmSheetFilters {
  const leadStatus = searchParams.get("leadStatus");
  const campaign = searchParams.get("campaign");
  const leadCategory = searchParams.get("leadCategory");
  const responseMode = searchParams.get("responseMode");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  return {
    ...(leadStatus ? { leadStatus } : {}),
    ...(campaign ? { campaign } : {}),
    ...(leadCategory ? { leadCategory } : {}),
    ...(responseMode && responseMode !== "all"
      ? { responseMode: responseMode as CrmSheetFilters["responseMode"] }
      : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  };
}

export async function GET(request: NextRequest) {
  const startedAtMs = Date.now();
  const searchParams = request.nextUrl.searchParams;
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  const clientId = searchParams.get("clientId") || null;

  if (!isAnalyticsReadApiEnabled()) {
    return readApiDisabledResponse({ endpoint: "crm/rows", requestId, clientId });
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

  const modeRaw = (searchParams.get("mode") || "rows").trim().toLowerCase();
  const mode: CrmReadMode =
    modeRaw === "summary" || modeRaw === "assignees" ? modeRaw : "rows";

  if (!clientId) {
    const response = NextResponse.json(
      { success: false, error: "Missing clientId" },
      { status: 400 }
    );
    response.headers.set("x-request-id", requestId);
    return response;
  }
  const cacheVersion = await getAnalyticsCacheVersion(clientId);

  if (mode === "assignees") {
    const cacheKey = buildAnalyticsRouteCacheKey({
      userId: authUser.id,
      clientId,
      endpoint: "crm-assignees",
      params: {},
      version: cacheVersion,
    });
    const cached = await readAnalyticsRouteCache<
      Awaited<ReturnType<typeof getCrmAssigneeOptions>>
    >(cacheKey);
    if (cached) {
      const response = NextResponse.json(cached, { status: 200 });
      response.headers.set("x-zrg-cache", "hit");
      return attachReadApiHeaders(attachAnalyticsTimingHeader(response, startedAtMs), {
        cacheControl: "private, max-age=60, stale-while-revalidate=120",
        requestId,
      });
    }

    const result = await getCrmAssigneeOptions({ clientId });
    if (!result.success) {
      const response = NextResponse.json(result, { status: mapAnalyticsErrorToStatus(result.error) });
      response.headers.set("x-request-id", requestId);
      return response;
    }
    await writeAnalyticsRouteCache(cacheKey, result, 60);
    const response = NextResponse.json(result, { status: 200 });
    response.headers.set("x-zrg-cache", "miss");
    return attachReadApiHeaders(attachAnalyticsTimingHeader(response, startedAtMs), {
      cacheControl: "private, max-age=60, stale-while-revalidate=120",
      requestId,
    });
  }

  const filters = parseCrmFilters(searchParams);

  if (mode === "summary") {
    const cacheKey = buildAnalyticsRouteCacheKey({
      userId: authUser.id,
      clientId,
      endpoint: "crm-summary",
      params: {
        campaign: filters.campaign,
        leadCategory: filters.leadCategory,
        leadStatus: filters.leadStatus,
        responseMode: filters.responseMode,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
      },
      version: cacheVersion,
    });
    const cached = await readAnalyticsRouteCache<
      Awaited<ReturnType<typeof getCrmWindowSummary>>
    >(cacheKey);
    if (cached) {
      const response = NextResponse.json(cached, { status: 200 });
      response.headers.set("x-zrg-cache", "hit");
      return attachReadApiHeaders(attachAnalyticsTimingHeader(response, startedAtMs), {
        cacheControl: "private, max-age=60, stale-while-revalidate=120",
        requestId,
      });
    }

    const result = await getCrmWindowSummary({ clientId, filters, authUser });
    if (!result.success) {
      const response = NextResponse.json(result, { status: mapAnalyticsErrorToStatus(result.error) });
      response.headers.set("x-request-id", requestId);
      return response;
    }
    await writeAnalyticsRouteCache(cacheKey, result, 60);
    const response = NextResponse.json(result, { status: 200 });
    response.headers.set("x-zrg-cache", "miss");
    return attachReadApiHeaders(attachAnalyticsTimingHeader(response, startedAtMs), {
      cacheControl: "private, max-age=60, stale-while-revalidate=120",
      requestId,
    });
  }

  const cursor = searchParams.get("cursor");
  const limit = parsePositiveInt(searchParams.get("limit"), 150);
  const cacheKey = buildAnalyticsRouteCacheKey({
    userId: authUser.id,
    clientId,
    endpoint: "crm-rows",
    params: {
      cursor,
      limit,
      campaign: filters.campaign,
      leadCategory: filters.leadCategory,
      leadStatus: filters.leadStatus,
      responseMode: filters.responseMode,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    },
    version: cacheVersion,
  });
  const cached = await readAnalyticsRouteCache<
    Awaited<ReturnType<typeof getCrmSheetRows>>
  >(cacheKey);
  if (cached) {
    const response = NextResponse.json(cached, { status: 200 });
    response.headers.set("x-zrg-cache", "hit");
    return attachReadApiHeaders(attachAnalyticsTimingHeader(response, startedAtMs), {
      cacheControl: "private, max-age=30, stale-while-revalidate=60",
      requestId,
    });
  }

  const result = await getCrmSheetRows({
    clientId,
    cursor,
    limit,
    filters,
    authUser,
  });

  if (!result.success) {
    const response = NextResponse.json(result, { status: mapAnalyticsErrorToStatus(result.error) });
    response.headers.set("x-request-id", requestId);
    return response;
  }

  await writeAnalyticsRouteCache(cacheKey, result, 30);
  const response = NextResponse.json(result, { status: 200 });
  response.headers.set("x-zrg-cache", "miss");
  return attachReadApiHeaders(attachAnalyticsTimingHeader(response, startedAtMs), {
    cacheControl: "private, max-age=30, stale-while-revalidate=60",
    requestId,
  });
}
