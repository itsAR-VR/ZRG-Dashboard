import "server-only";

export type ModelPricing = {
  inputUsdPer1MTokens: number;
  outputUsdPer1MTokens: number;
};

// Defaults can be overridden via AI_MODEL_PRICING_JSON.
// Format:
// {
//   "gpt-5.1": { "inputUsdPer1MTokens": 5, "outputUsdPer1MTokens": 15 },
//   "gpt-5-mini": { "inputUsdPer1MTokens": 0.3, "outputUsdPer1MTokens": 1.2 }
// }
const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-5.1": { inputUsdPer1MTokens: 5, outputUsdPer1MTokens: 15 },
  "gpt-5-mini": { inputUsdPer1MTokens: 0.3, outputUsdPer1MTokens: 1.2 },
  "gpt-5-nano": { inputUsdPer1MTokens: 0.05, outputUsdPer1MTokens: 0.2 },
};

function safeParsePricingJson(raw: string | undefined): Record<string, ModelPricing> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;

    const out: Record<string, ModelPricing> = {};
    for (const [model, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      const v = value as Partial<ModelPricing>;
      const input = typeof v.inputUsdPer1MTokens === "number" ? v.inputUsdPer1MTokens : null;
      const output = typeof v.outputUsdPer1MTokens === "number" ? v.outputUsdPer1MTokens : null;
      if (input === null || output === null) continue;
      if (input < 0 || output < 0) continue;
      out[model] = { inputUsdPer1MTokens: input, outputUsdPer1MTokens: output };
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

export function getModelPricing(model: string): ModelPricing | null {
  const overrides = safeParsePricingJson(process.env.AI_MODEL_PRICING_JSON);
  return overrides?.[model] || DEFAULT_MODEL_PRICING[model] || null;
}

export function estimateCostUsd(opts: {
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
}): number | null {
  const pricing = getModelPricing(opts.model);
  if (!pricing) return null;

  const inputTokens = typeof opts.inputTokens === "number" ? opts.inputTokens : 0;
  const outputTokens = typeof opts.outputTokens === "number" ? opts.outputTokens : 0;
  if (inputTokens < 0 || outputTokens < 0) return null;

  const inputCost = (inputTokens / 1_000_000) * pricing.inputUsdPer1MTokens;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputUsdPer1MTokens;
  return inputCost + outputCost;
}

