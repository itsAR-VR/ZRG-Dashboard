import "server-only";

import OpenAI from "openai";

import { formatOpenAiErrorSummary, getOpenAiErrorStatus, isRetryableOpenAiError } from "@/lib/ai/openai-error-utils";
import type { AIErrorCategory, PromptRunnerError } from "@/lib/ai/prompt-runner/types";

export function categorizePromptRunnerError(error: unknown): PromptRunnerError {
  const status = getOpenAiErrorStatus(error);
  const message = formatOpenAiErrorSummary(error);
  const retryable = isRetryableOpenAiError(error);

  let category: AIErrorCategory = "unknown";

  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    category = "timeout";
  } else if (error instanceof OpenAI.RateLimitError || status === 429) {
    category = "rate_limit";
  } else if (typeof status === "number" && status >= 500) {
    category = "api_error";
  } else if (typeof status === "number" && status === 408) {
    category = "timeout";
  } else if (typeof message === "string" && message.toLowerCase().includes("timeout")) {
    category = "timeout";
  }

  return { category, message, retryable };
}

