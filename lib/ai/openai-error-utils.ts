import "server-only";

import OpenAI from "openai";

export function getOpenAiErrorStatus(error: unknown): number | null {
  if (!error) return null;
  const anyErr = error as any;
  if (typeof anyErr.status === "number") return anyErr.status;
  if (typeof anyErr?.error?.status === "number") return anyErr.error.status;
  return null;
}

export function getOpenAiErrorRequestId(error: unknown): string | null {
  if (!error) return null;
  const anyErr = error as any;
  if (typeof anyErr.request_id === "string") return anyErr.request_id;
  if (typeof anyErr._request_id === "string") return anyErr._request_id;
  if (typeof anyErr?.response?._request_id === "string") return anyErr.response._request_id;
  return null;
}

export function isRetryableOpenAiError(error: unknown): boolean {
  if (!error) return false;

  // Typed OpenAI errors (preferred).
  if (error instanceof OpenAI.APIConnectionError) return true;
  if (error instanceof OpenAI.APIConnectionTimeoutError) return true;
  if (error instanceof OpenAI.RateLimitError) return true;
  if (error instanceof OpenAI.InternalServerError) return true;

  if (error instanceof OpenAI.APIError) {
    const status = error.status;
    if (!status) return false;
    if (status === 408 || status === 409 || status === 429) return true;
    if (status >= 500) return true;
    return false;
  }

  // Fallback: status-based detection.
  const status = getOpenAiErrorStatus(error);
  if (typeof status === "number") {
    if (status === 408 || status === 409 || status === 429) return true;
    if (status >= 500) return true;
  }

  return false;
}

export function formatOpenAiErrorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String((error as any)?.message || error || "Unknown error");
  const status = getOpenAiErrorStatus(error);
  const requestId = getOpenAiErrorRequestId(error);

  const parts: string[] = [];
  if (typeof status === "number") parts.push(`status=${status}`);
  if (requestId) parts.push(`request_id=${requestId}`);

  return parts.length ? `${message} (${parts.join(", ")})` : message;
}

