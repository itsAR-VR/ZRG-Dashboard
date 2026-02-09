/**
 * Auto-send revision loop model configuration (Phase 123).
 *
 * These coercion helpers validate/default workspace settings before passing to
 * the prompt runner. Mirrors patterns in `lib/ai-drafts/config.ts`.
 */

export const AUTO_SEND_REVISION_MODELS = ["gpt-5-mini", "gpt-5.1", "gpt-5.2"] as const;
export type AutoSendRevisionModel = (typeof AUTO_SEND_REVISION_MODELS)[number];

export const AUTO_SEND_REVISION_EFFORTS = ["low", "medium", "high", "extra_high"] as const;
export type AutoSendRevisionReasoningEffort = (typeof AUTO_SEND_REVISION_EFFORTS)[number];

export type AutoSendRevisionApiReasoningEffort = "low" | "medium" | "high" | "xhigh";

export function coerceAutoSendRevisionModel(value: string | null | undefined): AutoSendRevisionModel {
  const cleaned = (value || "").trim();
  if ((AUTO_SEND_REVISION_MODELS as readonly string[]).includes(cleaned)) {
    return cleaned as AutoSendRevisionModel;
  }
  return "gpt-5.2";
}

function coerceStoredReasoningEffort(value: string | null | undefined): AutoSendRevisionReasoningEffort {
  const cleaned = (value || "").trim();
  if ((AUTO_SEND_REVISION_EFFORTS as readonly string[]).includes(cleaned)) {
    return cleaned as AutoSendRevisionReasoningEffort;
  }
  // Some older configs might have stored "xhigh" directly.
  if (cleaned === "xhigh") return "extra_high";
  return "high";
}

export function coerceAutoSendRevisionReasoningEffort(opts: {
  model: AutoSendRevisionModel;
  storedValue: string | null | undefined;
}): { stored: AutoSendRevisionReasoningEffort; api: AutoSendRevisionApiReasoningEffort } {
  const stored = coerceStoredReasoningEffort(opts.storedValue);

  if (stored === "extra_high") {
    // xhigh is only supported on gpt-5.2; degrade safely elsewhere.
    if (opts.model === "gpt-5.2") return { stored, api: "xhigh" };
    return { stored: "high", api: "high" };
  }

  if (stored === "low") return { stored, api: "low" };
  if (stored === "medium") return { stored, api: "medium" };
  return { stored: "high", api: "high" };
}

export function coerceAutoSendRevisionMaxIterations(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(3, Math.trunc(value)));
}

