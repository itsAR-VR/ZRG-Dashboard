/**
 * Auto-send evaluator model configuration (Phase 127).
 *
 * These coercion helpers validate/default workspace settings and env vars before
 * passing to the prompt runner.
 */

export const AUTO_SEND_EVALUATOR_MODELS = ["gpt-5-mini", "gpt-5.1", "gpt-5.2"] as const;
export type AutoSendEvaluatorModel = (typeof AUTO_SEND_EVALUATOR_MODELS)[number];

export const AUTO_SEND_EVALUATOR_EFFORTS = ["low", "medium", "high", "extra_high"] as const;
export type AutoSendEvaluatorReasoningEffort = (typeof AUTO_SEND_EVALUATOR_EFFORTS)[number];

export type AutoSendEvaluatorApiReasoningEffort = "low" | "medium" | "high" | "xhigh";

export function coerceAutoSendEvaluatorModel(value: string | null | undefined): AutoSendEvaluatorModel {
  const cleaned = (value || "").trim();
  if ((AUTO_SEND_EVALUATOR_MODELS as readonly string[]).includes(cleaned)) {
    return cleaned as AutoSendEvaluatorModel;
  }
  return "gpt-5-mini";
}

function coerceStoredReasoningEffort(value: string | null | undefined): AutoSendEvaluatorReasoningEffort {
  const cleaned = (value || "").trim();
  if ((AUTO_SEND_EVALUATOR_EFFORTS as readonly string[]).includes(cleaned)) {
    return cleaned as AutoSendEvaluatorReasoningEffort;
  }
  if (cleaned === "xhigh") return "extra_high";
  return "low";
}

export function coerceAutoSendEvaluatorReasoningEffort(opts: {
  model: AutoSendEvaluatorModel;
  storedValue: string | null | undefined;
}): { stored: AutoSendEvaluatorReasoningEffort; api: AutoSendEvaluatorApiReasoningEffort } {
  const stored = coerceStoredReasoningEffort(opts.storedValue);

  if (stored === "extra_high") {
    if (opts.model === "gpt-5.2") return { stored, api: "xhigh" };
    return { stored: "high", api: "high" };
  }

  if (stored === "low") return { stored, api: "low" };
  if (stored === "medium") return { stored, api: "medium" };
  return { stored: "high", api: "high" };
}

