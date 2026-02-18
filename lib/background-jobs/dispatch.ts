import crypto from "crypto";

const DEFAULT_BACKGROUND_DISPATCH_WINDOW_SECONDS = 60;
const MIN_BACKGROUND_DISPATCH_WINDOW_SECONDS = 15;
const MAX_BACKGROUND_DISPATCH_WINDOW_SECONDS = 60 * 60;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function clampDispatchWindowSeconds(value: number): number {
  return Math.max(MIN_BACKGROUND_DISPATCH_WINDOW_SECONDS, Math.min(MAX_BACKGROUND_DISPATCH_WINDOW_SECONDS, value));
}

export function getBackgroundDispatchWindowSeconds(value = process.env.BACKGROUND_JOBS_DISPATCH_WINDOW_SECONDS): number {
  return clampDispatchWindowSeconds(parsePositiveInt(value, DEFAULT_BACKGROUND_DISPATCH_WINDOW_SECONDS));
}

export type BackgroundDispatchWindow = {
  dispatchKey: string;
  windowStart: Date;
  windowSeconds: number;
};

export function computeBackgroundDispatchWindow(
  requestedAt: Date,
  configuredWindowSeconds = getBackgroundDispatchWindowSeconds()
): BackgroundDispatchWindow {
  const windowSeconds = clampDispatchWindowSeconds(Math.trunc(configuredWindowSeconds));
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(requestedAt.getTime() / windowMs) * windowMs);

  return {
    dispatchKey: `background-jobs:v1:${windowSeconds}:${windowStart.toISOString()}`,
    windowStart,
    windowSeconds,
  };
}

function hashDispatchKey(dispatchKey: string): string {
  return crypto.createHash("sha256").update(dispatchKey).digest("hex").slice(0, 24);
}

export type BackgroundDispatchEventIds = {
  processDispatchId: string;
  maintenanceDispatchId: string;
};

export function buildBackgroundDispatchEventIds(dispatchKey: string): BackgroundDispatchEventIds {
  const digest = hashDispatchKey(dispatchKey);
  return {
    processDispatchId: `bg-process:${digest}`,
    maintenanceDispatchId: `bg-maint:${digest}`,
  };
}
