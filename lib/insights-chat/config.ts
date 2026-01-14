import "server-only";

export const INSIGHTS_CHAT_MODELS = ["gpt-5-mini", "gpt-5.1", "gpt-5.2"] as const;
export type InsightsChatModel = (typeof INSIGHTS_CHAT_MODELS)[number];

export const INSIGHTS_CHAT_EFFORTS = ["low", "medium", "high", "extra_high"] as const;
export type InsightsChatReasoningEffort = (typeof INSIGHTS_CHAT_EFFORTS)[number];

export type OpenAIReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

export function coerceInsightsChatModel(value: string | null | undefined): InsightsChatModel {
  const cleaned = (value || "").trim();
  if ((INSIGHTS_CHAT_MODELS as readonly string[]).includes(cleaned)) {
    return cleaned as InsightsChatModel;
  }
  return "gpt-5-mini";
}

function coerceStoredReasoningEffort(value: string | null | undefined): InsightsChatReasoningEffort {
  const cleaned = (value || "").trim();
  if ((INSIGHTS_CHAT_EFFORTS as readonly string[]).includes(cleaned)) {
    return cleaned as InsightsChatReasoningEffort;
  }
  // Some older configs might have stored "xhigh" directly.
  if (cleaned === "xhigh") return "extra_high";
  return "medium";
}

export function coerceInsightsChatReasoningEffort(opts: {
  model: InsightsChatModel;
  storedValue: string | null | undefined;
}): { stored: InsightsChatReasoningEffort; api: OpenAIReasoningEffort } {
  const stored = coerceStoredReasoningEffort(opts.storedValue);

  if (stored === "extra_high") {
    if (opts.model === "gpt-5.2") return { stored, api: "xhigh" };
    return { stored: "high", api: "high" };
  }

  if (stored === "low") return { stored, api: "low" };
  if (stored === "high") return { stored, api: "high" };
  return { stored: "medium", api: "medium" };
}

