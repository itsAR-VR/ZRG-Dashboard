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
  const modeRaw = (searchParams.get("mode") || "rows").trim().toLowerCase();
  const mode: CrmReadMode =
    modeRaw === "summary" || modeRaw === "assignees" ? modeRaw : "rows";

  const clientId = searchParams.get("clientId") || null;
  if (!clientId) {
    return NextResponse.json(
      { success: false, error: "Missing clientId" },
      { status: 400 }
    );
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
      });
    }

    const result = await getCrmAssigneeOptions({ clientId });
    if (!result.success) {
      return NextResponse.json(result, { status: mapAnalyticsErrorToStatus(result.error) });
    }
    await writeAnalyticsRouteCache(cacheKey, result, 60);
    const response = NextResponse.json(result, { status: 200 });
    response.headers.set("x-zrg-cache", "miss");
    return attachReadApiHeaders(attachAnalyticsTimingHeader(response, startedAtMs), {
      cacheControl: "private, max-age=60, stale-while-revalidate=120",
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
      });
    }

    const result = await getCrmWindowSummary({ clientId, filters });
    if (!result.success) {
      return NextResponse.json(result, { status: mapAnalyticsErrorToStatus(result.error) });
    }
    await writeAnalyticsRouteCache(cacheKey, result, 60);
    const response = NextResponse.json(result, { status: 200 });
    response.headers.set("x-zrg-cache", "miss");
    return attachReadApiHeaders(attachAnalyticsTimingHeader(response, startedAtMs), {
      cacheControl: "private, max-age=60, stale-while-revalidate=120",
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
    });
  }

  const result = await getCrmSheetRows({
    clientId,
    cursor,
    limit,
    filters,
  });

  if (!result.success) {
    return NextResponse.json(result, { status: mapAnalyticsErrorToStatus(result.error) });
  }

  await writeAnalyticsRouteCache(cacheKey, result, 30);
  const response = NextResponse.json(result, { status: 200 });
  response.headers.set("x-zrg-cache", "miss");
  return attachReadApiHeaders(attachAnalyticsTimingHeader(response, startedAtMs), {
    cacheControl: "private, max-age=30, stale-while-revalidate=60",
  });
}
