import "server-only";

import "@/lib/server-dns";
import type OpenAI from "openai";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { estimateCostUsd } from "@/lib/ai/pricing";
import { pruneOldAIInteractionsMaybe } from "@/lib/ai/retention";
import { openai } from "@/lib/ai/openai-client";
import { getAiTelemetrySource } from "@/lib/ai/telemetry-context";

function getDefaultMaxRetries(): number {
  const parsed = Number.parseInt(process.env.OPENAI_MAX_RETRIES || "5", 10);
  if (Number.isFinite(parsed) && parsed >= 0) return Math.min(10, parsed);
  return 5;
}

function isUnsupportedTemperatureError(error: unknown): boolean {
  const anyErr = error as any;
  const message = error instanceof Error ? error.message : String(anyErr?.message || "");
  const param =
    typeof anyErr?.param === "string"
      ? anyErr.param
      : typeof anyErr?.error?.param === "string"
        ? anyErr.error.param
        : null;

  return (
    param === "temperature" &&
    (message.includes("Unsupported parameter") || message.toLowerCase().includes("unsupported parameter"))
  );
}

function omitTemperature(params: OpenAI.Responses.ResponseCreateParamsNonStreaming): OpenAI.Responses.ResponseCreateParamsNonStreaming {
  const { temperature: _temperature, ...rest } = params as any;
  return rest as OpenAI.Responses.ResponseCreateParamsNonStreaming;
}

type UsageSnapshot = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  totalTokens?: number | null;
};

function extractUsageFromResponseApi(resp: any): UsageSnapshot {
  const usage = resp?.usage;
  if (!usage) return {};

  const reasoningTokens =
    typeof usage?.output_tokens_details?.reasoning_tokens === "number"
      ? usage.output_tokens_details.reasoning_tokens
      : typeof usage?.reasoning_tokens === "number"
        ? usage.reasoning_tokens
        : null;

  return {
    inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : null,
    outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : null,
    reasoningTokens,
    totalTokens: typeof usage.total_tokens === "number" ? usage.total_tokens : null,
  };
}

const AI_INTERACTION_METADATA_TOP_LEVEL_ALLOWLIST = new Set(["leadContextBundle", "followupParse", "bookingGate"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sanitizeMetadataValue(value: unknown, depth: number): unknown | undefined {
  const MAX_DEPTH = 6;
  const MAX_STRING_CHARS = 200;
  const MAX_ARRAY_LENGTH = 200;
  const MAX_OBJECT_KEYS = 200;

  if (depth > MAX_DEPTH) return undefined;
  if (value === null) return null;

  switch (typeof value) {
    case "string":
      return value.length <= MAX_STRING_CHARS ? value : undefined;
    case "number":
      return Number.isFinite(value) ? value : undefined;
    case "boolean":
      return value;
    case "object": {
      if (Array.isArray(value)) {
        const out: unknown[] = [];
        for (const item of value.slice(0, MAX_ARRAY_LENGTH)) {
          const sanitized = sanitizeMetadataValue(item, depth + 1);
          if (typeof sanitized !== "undefined") out.push(sanitized);
        }
        return out;
      }

      if (!isPlainObject(value)) return undefined;

      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
        if (typeof key !== "string" || key.length > 80) continue;
        const sanitized = sanitizeMetadataValue(child, depth + 1);
        if (typeof sanitized !== "undefined") out[key] = sanitized;
      }
      return out;
    }
    default:
      return undefined;
  }
}

export function sanitizeAiInteractionMetadata(metadata: unknown): Prisma.InputJsonValue | undefined {
  if (!isPlainObject(metadata)) return undefined;

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(metadata)) {
    if (!AI_INTERACTION_METADATA_TOP_LEVEL_ALLOWLIST.has(key)) continue;
    const sanitized = sanitizeMetadataValue(metadata[key], 0);
    if (typeof sanitized !== "undefined") out[key] = sanitized;
  }

  if (Object.keys(out).length === 0) return undefined;
  return out as Prisma.InputJsonValue;
}

async function recordInteraction(opts: {
  clientId: string;
  leadId?: string | null;
  source?: string | null;
  featureId: string;
  promptKey?: string | null;
  model: string;
  apiType: "responses" | "chat_completions";
  usage: UsageSnapshot;
  latencyMs: number;
  status: "success" | "error";
  errorMessage?: string | null;
  metadata?: unknown;
}): Promise<string> {
  const costUsd = estimateCostUsd({
    model: opts.model,
    inputTokens: opts.usage.inputTokens,
    outputTokens: opts.usage.outputTokens,
  });

  const sanitizedMetadata = sanitizeAiInteractionMetadata(opts.metadata);
  const created = await prisma.aIInteraction.create({
    data: {
      clientId: opts.clientId,
      leadId: opts.leadId || null,
      source: (opts.source ?? getAiTelemetrySource()) || null,
      featureId: opts.featureId,
      promptKey: opts.promptKey || null,
      model: opts.model,
      apiType: opts.apiType,
      inputTokens: opts.usage.inputTokens ?? null,
      outputTokens: opts.usage.outputTokens ?? null,
      reasoningTokens: opts.usage.reasoningTokens ?? null,
      totalTokens: opts.usage.totalTokens ?? null,
      latencyMs: Number.isFinite(opts.latencyMs) ? Math.max(0, Math.trunc(opts.latencyMs)) : null,
      status: opts.status,
      errorMessage: opts.errorMessage ? String(opts.errorMessage).slice(0, 10_000) : null,
      ...(sanitizedMetadata ? { metadata: sanitizedMetadata } : {}),
    },
  });

  // Keep the table bounded (best-effort).
  await pruneOldAIInteractionsMaybe();
  return created.id;
}

export async function markAiInteractionError(interactionId: string, errorMessage: string): Promise<void> {
  if (!interactionId) return;
  try {
    await prisma.aIInteraction.update({
      where: { id: interactionId },
      data: {
        status: "error",
        errorMessage: String(errorMessage || "Post-process error").slice(0, 10_000),
      },
    });
  } catch (error) {
    console.error("[AI Telemetry] Failed to mark interaction error:", error);
  }
}

export async function runResponseWithInteraction(opts: {
  clientId: string;
  leadId?: string | null;
  source?: string | null;
  featureId: string;
  promptKey?: string | null;
  params: OpenAI.Responses.ResponseCreateParamsNonStreaming;
  requestOptions?: OpenAI.RequestOptions;
  metadata?: unknown;
}): Promise<{ response: OpenAI.Responses.Response; interactionId: string | null }> {
  const start = Date.now();
  try {
    let resp: OpenAI.Responses.Response;
    const defaultTimeout = Math.max(5_000, Number.parseInt(process.env.OPENAI_TIMEOUT_MS || "90000", 10) || 90_000);
    const defaultMaxRetries = getDefaultMaxRetries();
    const requestOptions: OpenAI.RequestOptions = {
      timeout: defaultTimeout,
      maxRetries: defaultMaxRetries,
      ...opts.requestOptions,
    };
    try {
      resp = await openai.responses.create(opts.params, requestOptions);
    } catch (error) {
      // Some models reject `temperature` (400 invalid_request_error). Retry once without it.
      if ("temperature" in (opts.params as any) && isUnsupportedTemperatureError(error)) {
        resp = await openai.responses.create(omitTemperature(opts.params), requestOptions);
      } else {
        throw error;
      }
    }
    const latencyMs = Date.now() - start;
    const usage = extractUsageFromResponseApi(resp);

    let interactionId: string | null = null;
    try {
      interactionId = await recordInteraction({
        clientId: opts.clientId,
        leadId: opts.leadId,
        source: opts.source,
        featureId: opts.featureId,
        promptKey: opts.promptKey,
        model: String(opts.params.model),
        apiType: "responses",
        usage,
        latencyMs,
        status: "success",
        metadata: opts.metadata,
      });
    } catch (logError) {
      console.error("[AI Telemetry] Failed to record response interaction:", logError);
    }

    return { response: resp, interactionId };
  } catch (error) {
    const latencyMs = Date.now() - start;
    const message = error instanceof Error ? error.message : "Unknown error";

    try {
      await recordInteraction({
        clientId: opts.clientId,
        leadId: opts.leadId,
        source: opts.source,
        featureId: opts.featureId,
        promptKey: opts.promptKey,
        model: String(opts.params.model),
        apiType: "responses",
        usage: {},
        latencyMs,
        status: "error",
        errorMessage: message,
        metadata: opts.metadata,
      });
    } catch (logError) {
      console.error("[AI Telemetry] Failed to record response error:", logError);
    }

    throw error;
  }
}

export async function runResponse(opts: {
  clientId: string;
  leadId?: string | null;
  source?: string | null;
  featureId: string;
  promptKey?: string | null;
  params: OpenAI.Responses.ResponseCreateParamsNonStreaming;
  requestOptions?: OpenAI.RequestOptions;
}): Promise<OpenAI.Responses.Response> {
  const { response } = await runResponseWithInteraction(opts);
  return response;
}
