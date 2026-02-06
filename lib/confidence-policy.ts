import "server-only";

import { prisma } from "@/lib/prisma";

export type ConfidencePolicyConfig = {
  thresholds: Record<string, number>;
};

export type ConfidencePolicySource = "db" | "default";

export const CONFIDENCE_POLICY_KEYS = {
  followupAutoBook: "followup.auto_book",
} as const;

const DEFAULT_CONFIGS: Record<string, ConfidencePolicyConfig> = {
  [CONFIDENCE_POLICY_KEYS.followupAutoBook]: {
    thresholds: {
      // Phase 112f: replaces hardcoded HIGH_CONFIDENCE_THRESHOLD=0.9 in followup engine.
      proposed_times_match_threshold: 0.9,
    },
  },
};

export function listSupportedConfidencePolicyKeys(): string[] {
  return Object.keys(DEFAULT_CONFIGS);
}

export function getDefaultConfidencePolicyConfig(policyKey: string): ConfidencePolicyConfig | null {
  return DEFAULT_CONFIGS[policyKey] ?? null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function coerceConfidencePolicyConfig(policyKey: string, raw: unknown): ConfidencePolicyConfig {
  const fallback = getDefaultConfidencePolicyConfig(policyKey) ?? { thresholds: {} };
  if (!isPlainRecord(raw)) return fallback;

  const thresholdsRaw = raw.thresholds;
  if (!isPlainRecord(thresholdsRaw)) return fallback;

  const thresholds: Record<string, number> = { ...fallback.thresholds };
  for (const [key, value] of Object.entries(thresholdsRaw)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      thresholds[key] = value;
    }
  }

  return { thresholds };
}

export function resolveThresholdFromConfig(opts: {
  policyKey: string;
  field: string;
  config: ConfidencePolicyConfig | null | undefined;
}): number | null {
  const fallback = getDefaultConfidencePolicyConfig(opts.policyKey);
  const candidate = opts.config?.thresholds?.[opts.field];
  if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  const fallbackValue = fallback?.thresholds?.[opts.field];
  if (typeof fallbackValue === "number" && Number.isFinite(fallbackValue)) return fallbackValue;
  return null;
}

export async function getConfidencePolicy(
  clientId: string,
  policyKey: string
): Promise<{ policyId: string | null; source: ConfidencePolicySource; config: ConfidencePolicyConfig }> {
  const row = await prisma.confidencePolicy.findUnique({
    where: { clientId_policyKey: { clientId, policyKey } },
    select: { id: true, config: true },
  });

  if (!row) {
    return {
      policyId: null,
      source: "default",
      config: coerceConfidencePolicyConfig(policyKey, getDefaultConfidencePolicyConfig(policyKey)),
    };
  }

  return {
    policyId: row.id,
    source: "db",
    config: coerceConfidencePolicyConfig(policyKey, row.config),
  };
}

export async function resolveThreshold(clientId: string, policyKey: string, field: string): Promise<number> {
  const policy = await getConfidencePolicy(clientId, policyKey);
  const resolved = resolveThresholdFromConfig({ policyKey, field, config: policy.config });
  if (resolved === null) {
    throw new Error(`Unknown confidence threshold: policyKey=${policyKey} field=${field}`);
  }
  return resolved;
}

