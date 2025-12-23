import "server-only";

import type OpenAI from "openai";
import { openai } from "@/lib/ai/openai-client";

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function approximateTokensFromText(text: string): number {
  // Rough heuristic: ~4 characters per token for English-ish text.
  return Math.max(0, Math.ceil((text || "").length / 4));
}

function approximateTokensFromInput(input: OpenAI.Responses.ResponseCreateParamsNonStreaming["input"]): number {
  if (typeof input === "string") return approximateTokensFromText(input);
  try {
    return approximateTokensFromText(JSON.stringify(input));
  } catch {
    return 0;
  }
}

async function countInputTokensViaApi(opts: {
  model: string;
  instructions?: string | null;
  input?: OpenAI.Responses.ResponseCreateParamsNonStreaming["input"];
}): Promise<number | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  // Allow disabling this extra request (latency/cost) without code changes.
  const enabled = (process.env.AI_USE_INPUT_TOKENS_COUNT ?? "true").toLowerCase() !== "false";
  if (!enabled) return null;

  try {
    const resp = await openai.responses.inputTokens.count({
      model: opts.model,
      instructions: opts.instructions ?? null,
      input: (opts.input ?? null) as any,
    });
    return typeof resp?.input_tokens === "number" ? resp.input_tokens : null;
  } catch {
    return null;
  }
}

export type AdaptiveMaxOutputTokensResult = {
  inputTokens: number;
  inputTokensSource: "api" | "heuristic";
  maxOutputTokens: number;
};

export async function computeAdaptiveMaxOutputTokens(opts: {
  model: string;
  instructions?: string | null;
  input?: OpenAI.Responses.ResponseCreateParamsNonStreaming["input"];
  min: number;
  max: number;
  /**
   * Target `max_output_tokens` ~= `inputTokens + overhead`.
   * This creates additional headroom for reasoning tokens (since they are counted
   * in `max_output_tokens` for GPT-5 / o-series models).
   */
  overheadTokens?: number;
  /**
   * If true, attempts to call the API token-count endpoint first.
   * Falls back to heuristic if unavailable/fails.
   */
  preferApiCount?: boolean;
}): Promise<AdaptiveMaxOutputTokensResult> {
  const preferApiCount = Boolean(opts.preferApiCount);
  const overhead = typeof opts.overheadTokens === "number" ? opts.overheadTokens : 192;

  const apiCount = preferApiCount
    ? await countInputTokensViaApi({ model: opts.model, instructions: opts.instructions, input: opts.input })
    : null;

  const inputTokens =
    typeof apiCount === "number" && apiCount >= 0
      ? apiCount
      : approximateTokensFromInput(opts.input);
  const source: AdaptiveMaxOutputTokensResult["inputTokensSource"] =
    typeof apiCount === "number" && apiCount >= 0 ? "api" : "heuristic";

  // "Thinking tokens" live inside `max_output_tokens` as reasoning tokens.
  // Keep it roughly proportional to input size, with fixed overhead.
  const target = inputTokens + overhead;
  const maxOutputTokens = clampInt(target, opts.min, opts.max);

  return { inputTokens, inputTokensSource: source, maxOutputTokens };
}

