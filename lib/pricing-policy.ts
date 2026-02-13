export type PricingCadence = "monthly" | "annual" | "quarterly";

export type PricingPolicy = {
  forceCadence: PricingCadence | null;
  suppressUnrequestedMonthlyEquivalent: boolean;
  suppressSecondaryOptionWithoutCadenceIntent: boolean;
};

type PricingPolicyOverride = Partial<{
  forceCadence: PricingCadence | null;
  suppressUnrequestedMonthlyEquivalent: boolean;
  suppressSecondaryOptionWithoutCadenceIntent: boolean;
}>;

const MONTHLY_INTENT_REGEX = /\b(monthly|per\s+month|\/\s?(?:mo|month))\b/i;
const QUARTERLY_INTENT_REGEX = /\b(quarterly|per\s+quarter|\/\s?(?:qtr|quarter))\b/i;
const ANNUAL_INTENT_REGEX = /\b(annual|annually|yearly|per\s+year|\/\s?(?:yr|year))\b/i;

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = (process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function parseForceQuarterlyClientIds(): Set<string> {
  const raw = (process.env.AI_PRICING_FORCE_QUARTERLY_CLIENT_IDS || "").trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function parseOverrides(): Record<string, PricingPolicyOverride> {
  const raw = (process.env.AI_PRICING_POLICY_OVERRIDES_JSON || "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, PricingPolicyOverride>;
  } catch {
    return {};
  }
}

function normalizeForceCadence(value: unknown): PricingCadence | null {
  if (value === "monthly" || value === "annual" || value === "quarterly") return value;
  return null;
}

export function resolvePricingPolicy(clientId: string | null | undefined): PricingPolicy {
  const defaultPolicy: PricingPolicy = {
    forceCadence: null,
    suppressUnrequestedMonthlyEquivalent: parseBooleanEnv("AI_PRICING_SUPPRESS_UNREQUESTED_MONTHLY", true),
    suppressSecondaryOptionWithoutCadenceIntent: parseBooleanEnv(
      "AI_PRICING_SUPPRESS_SECONDARY_OPTION_WITHOUT_CADENCE_INTENT",
      true
    ),
  };

  const trimmedClientId = (clientId || "").trim();
  if (!trimmedClientId) return defaultPolicy;

  const forceQuarterlyClientIds = parseForceQuarterlyClientIds();
  const overrides = parseOverrides();
  const override = overrides[trimmedClientId] || {};

  const forceCadence =
    normalizeForceCadence(override.forceCadence) ||
    (forceQuarterlyClientIds.has(trimmedClientId) ? "quarterly" : defaultPolicy.forceCadence);

  return {
    forceCadence,
    suppressUnrequestedMonthlyEquivalent:
      typeof override.suppressUnrequestedMonthlyEquivalent === "boolean"
        ? override.suppressUnrequestedMonthlyEquivalent
        : defaultPolicy.suppressUnrequestedMonthlyEquivalent,
    suppressSecondaryOptionWithoutCadenceIntent:
      typeof override.suppressSecondaryOptionWithoutCadenceIntent === "boolean"
        ? override.suppressSecondaryOptionWithoutCadenceIntent
        : defaultPolicy.suppressSecondaryOptionWithoutCadenceIntent,
  };
}

export function hasExplicitMonthlyPricingIntent(text: string | null | undefined): boolean {
  return MONTHLY_INTENT_REGEX.test((text || "").trim());
}

export function hasExplicitCadenceIntent(text: string | null | undefined): boolean {
  const source = (text || "").trim();
  if (!source) return false;
  return MONTHLY_INTENT_REGEX.test(source) || QUARTERLY_INTENT_REGEX.test(source) || ANNUAL_INTENT_REGEX.test(source);
}

export function hasMonthlyCadenceText(text: string | null | undefined): boolean {
  return MONTHLY_INTENT_REGEX.test((text || "").trim());
}

export function buildPricingPolicyContext(policy: PricingPolicy): string {
  const lines: string[] = [];
  if (policy.forceCadence) {
    lines.push(`- Required billing cadence language: ${policy.forceCadence}.`);
  }
  if (policy.suppressUnrequestedMonthlyEquivalent) {
    lines.push("- Do not include monthly-equivalent pricing unless the lead explicitly asks for monthly cadence.");
  }
  if (policy.suppressSecondaryOptionWithoutCadenceIntent) {
    lines.push("- For generic fee questions, provide a single canonical pricing statement before optional context.");
  }
  return lines.join("\n");
}
