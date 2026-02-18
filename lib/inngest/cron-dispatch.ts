import "server-only";

import crypto from "crypto";

import type { CronDispatchEventData } from "@/lib/inngest/events";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export function parseBooleanFlag(value: string | undefined): boolean {
  if (!value) return false;
  return TRUE_VALUES.has(value.trim().toLowerCase());
}

export function isInngestConfigured(): boolean {
  return Boolean(process.env.INNGEST_EVENT_KEY?.trim());
}

function floorToDispatchWindow(date: Date, windowSeconds: number): Date {
  const safeWindowSeconds = Math.max(1, Math.trunc(windowSeconds));
  const windowMs = safeWindowSeconds * 1000;
  return new Date(Math.floor(date.getTime() / windowMs) * windowMs);
}

function formatUtcMinuteBucket(date: Date): string {
  return date.toISOString().slice(0, 16);
}

function buildParamsHash(params: Record<string, string> | undefined): string | null {
  if (!params || Object.keys(params).length === 0) return null;
  const normalized = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .reduce<Record<string, string>>((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {});
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 16);
}

export function collectDispatchParams(
  searchParams: URLSearchParams,
  allowlist: readonly string[]
): Record<string, string> | undefined {
  const collected: Record<string, string> = {};

  for (const key of allowlist) {
    const rawValue = searchParams.get(key);
    if (!rawValue) continue;
    const value = rawValue.trim();
    if (!value) continue;
    collected[key] = value;
  }

  return Object.keys(collected).length > 0 ? collected : undefined;
}

type BuildCronDispatchContextInput = {
  job: string;
  source: string;
  dispatchWindowSeconds: number;
  params?: Record<string, string>;
};

export function buildCronDispatchContext(input: BuildCronDispatchContextInput): {
  requestedAt: string;
  dispatchData: CronDispatchEventData;
} {
  const now = new Date();
  const requestedAt = now.toISOString();
  const windowStart = floorToDispatchWindow(now, input.dispatchWindowSeconds);
  const minuteBucket = formatUtcMinuteBucket(windowStart);
  const paramsHash = buildParamsHash(input.params);
  const dispatchKey = paramsHash
    ? `cron:${input.job}:${minuteBucket}:${paramsHash}`
    : `cron:${input.job}:${minuteBucket}`;

  return {
    requestedAt,
    dispatchData: {
      source: input.source,
      requestedAt,
      dispatchKey,
      correlationId: crypto.randomUUID(),
      dispatchWindowStart: windowStart.toISOString(),
      dispatchWindowSeconds: Math.max(1, Math.trunc(input.dispatchWindowSeconds)),
      ...(input.params ? { params: input.params } : {}),
    },
  };
}

export function buildCronEventId(eventName: string, dispatchKey: string): string {
  return `${eventName}:${dispatchKey}`;
}
