import { NextResponse } from "next/server";
import { redisGetJson, redisSetJson } from "@/lib/redis";

const REQUEST_ID_HEADER = "x-request-id";
const READ_API_DISABLED_REASON = "disabled_by_flag";

export function mapAnalyticsErrorToStatus(error: string | undefined): number {
  const message = (error || "").trim();
  if (message === "Not authenticated") return 401;
  if (message === "Unauthorized") return 403;
  return 500;
}

function normalizeRequestId(raw: string | null | undefined): string {
  const trimmed = (raw || "").trim();
  if (trimmed) return trimmed.slice(0, 128);
  return crypto.randomUUID();
}

export function resolveRequestId(requestId: string | null | undefined): string {
  return normalizeRequestId(requestId);
}

export function readApiDisabledResponse(opts?: {
  endpoint?: string;
  requestId?: string | null;
  clientId?: string | null;
}) {
  const requestId = normalizeRequestId(opts?.requestId);
  const endpoint = opts?.endpoint || "analytics";
  const clientId = (opts?.clientId || "").trim() || null;
  console.warn(
    "[Read API] disabled",
    JSON.stringify({
      area: "analytics",
      endpoint,
      requestId,
      clientId,
      reason: READ_API_DISABLED_REASON,
    })
  );

  const response = NextResponse.json(
    { success: false, error: "READ_API_DISABLED" },
    { status: 503 }
  );
  response.headers.set("x-zrg-read-api-enabled", "0");
  response.headers.set("x-zrg-read-api-reason", READ_API_DISABLED_REASON);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.headers.set("Cache-Control", "private, max-age=0, must-revalidate");
  return response;
}

export function attachReadApiHeaders(
  response: NextResponse,
  opts?: { cacheControl?: string; requestId?: string | null }
): NextResponse {
  response.headers.set("x-zrg-read-api-enabled", "1");
  if (opts?.requestId) {
    response.headers.set(REQUEST_ID_HEADER, normalizeRequestId(opts.requestId));
  }
  response.headers.set(
    "Cache-Control",
    opts?.cacheControl ?? "private, max-age=60, stale-while-revalidate=120"
  );
  return response;
}

export function attachAnalyticsTimingHeader(
  response: NextResponse,
  startedAtMs: number
): NextResponse {
  const durationMs = Math.max(0, Date.now() - startedAtMs);
  response.headers.set("x-zrg-duration-ms", String(durationMs));
  return response;
}

const ANALYTICS_VERSION_KEY_PREFIX = "analytics:v1:ver:";

export async function getAnalyticsCacheVersion(
  clientId: string | null | undefined
): Promise<number> {
  const normalizedClientId = (clientId || "").trim();
  if (!normalizedClientId) return 0;
  const raw = await redisGetJson<number | string>(
    `${ANALYTICS_VERSION_KEY_PREFIX}${normalizedClientId}`
  );
  const parsed =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseInt(raw, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.trunc(parsed);
}

function buildParamsFragment(
  params: Record<string, string | number | boolean | null | undefined>
): string {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== null && value !== undefined && String(value).length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "none";
  return entries.map(([key, value]) => `${key}=${String(value)}`).join("&");
}

export function buildAnalyticsRouteCacheKey(opts: {
  userId: string;
  clientId: string | null | undefined;
  endpoint: string;
  params: Record<string, string | number | boolean | null | undefined>;
  version: number;
}): string {
  const normalizedUserId = opts.userId.trim() || "anon";
  const normalizedClientId = (opts.clientId || "").trim() || "__all__";
  const normalizedEndpoint = opts.endpoint.trim() || "unknown";
  const paramsFragment = buildParamsFragment(opts.params);
  return `analytics:v1:${normalizedUserId}:${normalizedClientId}:${normalizedEndpoint}:${paramsFragment}:v${opts.version}`;
}

export async function readAnalyticsRouteCache<T>(key: string): Promise<T | null> {
  const normalized = key.trim();
  if (!normalized) return null;
  return redisGetJson<T>(normalized);
}

export async function writeAnalyticsRouteCache(
  key: string,
  value: unknown,
  exSeconds: number
): Promise<void> {
  const normalized = key.trim();
  if (!normalized) return;
  if (!Number.isFinite(exSeconds) || exSeconds <= 0) return;
  await redisSetJson(normalized, value, { exSeconds: Math.trunc(exSeconds) });
}
