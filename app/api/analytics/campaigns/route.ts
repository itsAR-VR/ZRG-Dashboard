import { NextRequest, NextResponse } from "next/server";

import {
  getEmailCampaignAnalytics,
  getReactivationCampaignAnalytics,
} from "@/actions/analytics-actions";
import {
  getAiDraftBookingConversionStats,
  getAiDraftResponseOutcomeStats,
} from "@/actions/ai-draft-response-analytics-actions";
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

type CampaignsReadPayload = {
  campaigns: Awaited<ReturnType<typeof getEmailCampaignAnalytics>>["data"] | null;
  reactivation: Awaited<ReturnType<typeof getReactivationCampaignAnalytics>>["data"] | null;
  aiDraftOutcome: Awaited<ReturnType<typeof getAiDraftResponseOutcomeStats>>["data"] | null;
  aiDraftBooking: Awaited<ReturnType<typeof getAiDraftBookingConversionStats>>["data"] | null;
};

type CampaignsRouteResponse = {
  success: true;
  data: CampaignsReadPayload;
  errors?: Record<string, string>;
};

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
    endpoint: "campaigns",
    params: { from, to },
    version: cacheVersion,
  });

  const cached = await readAnalyticsRouteCache<CampaignsRouteResponse>(cacheKey);
  if (cached) {
    const response = NextResponse.json(cached, { status: 200 });
    response.headers.set("x-zrg-cache", "hit");
    return attachReadApiHeaders(attachAnalyticsTimingHeader(response, startedAtMs), {
      cacheControl: "private, max-age=120, stale-while-revalidate=300",
    });
  }

  const params = {
    clientId,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };

  const [campaignsResult, reactivationResult, aiDraftOutcomeResult, aiDraftBookingResult] =
    await Promise.all([
      getEmailCampaignAnalytics(params),
      getReactivationCampaignAnalytics(params),
      getAiDraftResponseOutcomeStats(params),
      getAiDraftBookingConversionStats(params),
    ]);

  const results = [
    campaignsResult,
    reactivationResult,
    aiDraftOutcomeResult,
    aiDraftBookingResult,
  ];
  const authFailure = results.find(
    (result) =>
      !result.success &&
      (result.error === "Not authenticated" || result.error === "Unauthorized")
  );
  if (authFailure && !authFailure.success) {
    return NextResponse.json(authFailure, {
      status: mapAnalyticsErrorToStatus(authFailure.error),
    });
  }

  const data: CampaignsReadPayload = {
    campaigns: campaignsResult.success ? campaignsResult.data ?? null : null,
    reactivation: reactivationResult.success ? reactivationResult.data ?? null : null,
    aiDraftOutcome: aiDraftOutcomeResult.success ? aiDraftOutcomeResult.data ?? null : null,
    aiDraftBooking: aiDraftBookingResult.success ? aiDraftBookingResult.data ?? null : null,
  };

  const errors: Record<string, string> = {};
  if (!campaignsResult.success) errors.campaigns = campaignsResult.error || "Failed to load campaigns";
  if (!reactivationResult.success) errors.reactivation = reactivationResult.error || "Failed to load reactivation";
  if (!aiDraftOutcomeResult.success) errors.aiDraftOutcome = aiDraftOutcomeResult.error || "Failed to load AI outcomes";
  if (!aiDraftBookingResult.success) errors.aiDraftBooking = aiDraftBookingResult.error || "Failed to load AI booking";

  const hasAnySuccess = Object.values(data).some((value) => value !== null);
  if (!hasAnySuccess) {
    const firstError = Object.values(errors)[0] || "Failed to load campaign analytics";
    return NextResponse.json(
      { success: false, error: firstError, errors },
      { status: mapAnalyticsErrorToStatus(firstError) }
    );
  }

  const payload: CampaignsRouteResponse = {
    success: true,
    data,
    ...(Object.keys(errors).length > 0 ? { errors } : {}),
  };
  await writeAnalyticsRouteCache(cacheKey, payload, 120);
  const response = NextResponse.json(payload, { status: 200 });
  response.headers.set("x-zrg-cache", "miss");
  return attachReadApiHeaders(attachAnalyticsTimingHeader(response, startedAtMs), {
    cacheControl: "private, max-age=120, stale-while-revalidate=300",
  });
}
