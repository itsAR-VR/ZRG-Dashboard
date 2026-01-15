import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

type AiTelemetryContext = {
  source: string | null;
};

const storage = new AsyncLocalStorage<AiTelemetryContext>();

function normalizeSource(source: string | null | undefined): string | null {
  if (typeof source !== "string") return null;
  const trimmed = source.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 500);
}

export function withAiTelemetrySource<T>(source: string | null | undefined, fn: () => T): T {
  return storage.run({ source: normalizeSource(source) }, fn);
}

export function withAiTelemetrySourceIfUnset<T>(source: string | null | undefined, fn: () => T): T {
  const existing = storage.getStore()?.source;
  if (existing) return fn();
  return withAiTelemetrySource(source, fn);
}

export function getAiTelemetrySource(): string | null {
  return storage.getStore()?.source ?? null;
}

