import "server-only";

import { randomUUID } from "node:crypto";
import type OpenAI from "openai";

import { computeAdaptiveMaxOutputTokens } from "@/lib/ai/token-budget";
import { markAiInteractionError, runResponseWithInteraction } from "@/lib/ai/openai-telemetry";
import { extractJsonObjectFromText, getTrimmedOutputText, summarizeResponseForTelemetry } from "@/lib/ai/response-utils";
import { categorizePromptRunnerError } from "@/lib/ai/prompt-runner/errors";
import { resolvePromptTemplate } from "@/lib/ai/prompt-runner/resolve";
import type { PromptRunnerError, PromptRunnerResult, StructuredJsonPromptParams, TextPromptParams } from "@/lib/ai/prompt-runner/types";

function coerceMaxAttempts(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof parsed === "number") return Math.max(1, Math.min(10, parsed));
  return fallback;
}

function getDefaultMaxAttempts(): number {
  const parsed = Number.parseInt(process.env.OPENAI_PROMPT_MAX_ATTEMPTS || "2", 10);
  if (Number.isFinite(parsed) && parsed > 0) return Math.max(1, Math.min(10, parsed));
  return 2;
}

function coerceRetryMultiplier(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : null;
  if (typeof parsed === "number" && parsed > 1) return Math.max(1.01, Math.min(3, parsed));
  return fallback;
}

function getDefaultRetryMultiplier(): number {
  const parsed = Number.parseFloat(process.env.OPENAI_RETRY_OUTPUT_TOKENS_MULTIPLIER || "1.2");
  if (Number.isFinite(parsed) && parsed > 1) return Math.max(1.01, Math.min(3, parsed));
  return 1.2;
}

function expandAttemptsWithMultiplier(opts: {
  attempts: number[];
  maxAttempts: number;
  multiplier: number;
  cap: number;
}): number[] {
  const out = [...opts.attempts];
  while (out.length < opts.maxAttempts) {
    const prev = out[out.length - 1] ?? 0;
    const nextRaw = Math.ceil(prev * opts.multiplier);
    const next = Math.min(opts.cap, Math.max(prev + 1, nextRaw));
    if (!Number.isFinite(next) || next <= prev) break;
    out.push(next);
  }
  return out;
}

function resolveTemperatureAndReasoning(opts: {
  model: string;
  temperature: number | null;
  reasoningEffort: StructuredJsonPromptParams<unknown>["reasoningEffort"] | null;
}): {
  temperature?: number;
  reasoning?: { effort: NonNullable<StructuredJsonPromptParams<unknown>["reasoningEffort"]> };
} {
  const hasTemperature = typeof opts.temperature === "number" && Number.isFinite(opts.temperature);
  if (hasTemperature) {
    // OpenAI model compatibility: temperature requires reasoning effort = "none" on gpt-5.* models.
    if (opts.model === "gpt-5.2" || opts.model.startsWith("gpt-5")) {
      return { temperature: opts.temperature!, reasoning: { effort: "none" } };
    }
    // For other models, omit reasoning to preserve temperature controls when supported.
    return { temperature: opts.temperature! };
  }

  if (opts.reasoningEffort) {
    return { reasoning: { effort: opts.reasoningEffort } };
  }

  return {};
}

function buildTelemetryBase(opts: {
  traceId?: string;
  parentSpanId?: string | null;
  interactionId: string | null;
  promptKey: string;
  featureId: string;
  model: string;
  pattern: "structured_json" | "text";
  attemptCount: number;
}): {
  traceId: string;
  spanId: string | null;
  parentSpanId?: string | null;
  interactionId: string | null;
  promptKey: string;
  featureId: string;
  model: string;
  pattern: "structured_json" | "text";
  attemptCount: number;
} {
  const traceId = opts.traceId || randomUUID();
  const spanId = opts.interactionId || null;
  return {
    traceId,
    spanId,
    ...(opts.parentSpanId ? { parentSpanId: opts.parentSpanId } : {}),
    interactionId: opts.interactionId,
    promptKey: opts.promptKey,
    featureId: opts.featureId,
    model: opts.model,
    pattern: opts.pattern,
    attemptCount: opts.attemptCount,
  };
}

function normalizeAttempts(attempts: number[]): number[] {
  return attempts
    .map((n) => (Number.isFinite(n) ? Math.max(1, Math.trunc(n)) : 0))
    .filter((n) => n > 0);
}

export async function runStructuredJsonPrompt<T>(params: StructuredJsonPromptParams<T>): Promise<PromptRunnerResult<T>> {
  const resolved =
    params.resolved ??
    (await resolvePromptTemplate({
      promptKey: params.promptKey,
      clientId: params.clientId,
      systemFallback: params.systemFallback,
      templateVars: params.templateVars,
    }));

  const system = resolved.system;
  const featureId = resolved.featureId;
  const promptKeyForTelemetry = resolved.promptKeyForTelemetry;

  const seedAttempts: number[] = Array.isArray(params.attempts) && params.attempts.length > 0 ? normalizeAttempts(params.attempts) : [];

  const envMaxAttempts = getDefaultMaxAttempts();
  const maxAttempts = coerceMaxAttempts(params.maxAttempts, Math.max(seedAttempts.length, envMaxAttempts));
  const multiplier = coerceRetryMultiplier(params.retryOutputTokensMultiplier, getDefaultRetryMultiplier());

  const cap = (() => {
    const retryMax =
      typeof params.budget.retryMax === "number" && Number.isFinite(params.budget.retryMax)
        ? Math.max(1, Math.trunc(params.budget.retryMax))
        : null;
    if (retryMax) return retryMax;

    const baseMax =
      typeof params.budget.max === "number" && Number.isFinite(params.budget.max) ? Math.max(1, Math.trunc(params.budget.max)) : 800;
    return Math.ceil(baseMax * Math.pow(multiplier, Math.max(0, maxAttempts - 1)));
  })();

  const attempts: number[] = [...seedAttempts];

  if (attempts.length === 0) {
    const budget = await computeAdaptiveMaxOutputTokens({
      model: params.model,
      instructions: system,
      input: params.input,
      min: params.budget.min,
      max: params.budget.max,
      overheadTokens: params.budget.overheadTokens,
      outputScale: params.budget.outputScale,
      preferApiCount: params.budget.preferApiCount,
    });

    attempts.push(budget.maxOutputTokens);
  }

  // Auto-expand attempts with a percentage-based increase (default +20%).
  const expandedAttempts = expandAttemptsWithMultiplier({
    attempts,
    maxAttempts: Math.max(attempts.length, maxAttempts),
    multiplier,
    cap: Math.max(cap, ...attempts),
  });

  const samplingAndReasoning = resolveTemperatureAndReasoning({
    model: params.model,
    temperature: typeof params.temperature === "number" && Number.isFinite(params.temperature) ? params.temperature : null,
    reasoningEffort: params.reasoningEffort ?? null,
  });

  let lastInteractionId: string | null = null;
  let lastError: { category: "parse_error" | "schema_violation" | "incomplete_output"; message: string; raw?: string } | null = null;
  let lastRaw: string | null = null;
  let lastRequestError: ReturnType<typeof categorizePromptRunnerError> | null = null;

  for (let attemptIndex = 0; attemptIndex < expandedAttempts.length; attemptIndex++) {
    const maxOutputTokens = expandedAttempts[attemptIndex]!;
    const attemptSuffix = attemptIndex === 0 ? "" : `.retry${attemptIndex + 1}`;

    try {
      const { response, interactionId } = await runResponseWithInteraction({
        clientId: params.clientId,
        leadId: params.leadId,
        source: params.source,
        featureId: params.featureId || featureId,
        promptKey: promptKeyForTelemetry + attemptSuffix,
        params: {
          model: params.model,
          ...samplingAndReasoning,
          max_output_tokens: maxOutputTokens,
          instructions: system,
          text: {
            verbosity: params.verbosity ?? "low",
            format: {
              type: "json_schema",
              name: params.schemaName,
              strict: params.strict ?? true,
              schema: params.schema,
            },
          },
          input: params.input,
        } satisfies OpenAI.Responses.ResponseCreateParamsNonStreaming,
        requestOptions: (() => {
          const timeout =
            typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
              ? Math.trunc(params.timeoutMs)
              : null;
          const maxRetries =
            typeof params.maxRetries === "number" && Number.isFinite(params.maxRetries)
              ? Math.max(0, Math.trunc(params.maxRetries))
              : null;
          return {
            ...(typeof timeout === "number" && timeout > 0 ? { timeout } : {}),
            ...(typeof maxRetries === "number" ? { maxRetries } : {}),
          };
        })(),
      });

      lastInteractionId = interactionId;

      const text = getTrimmedOutputText(response);
      if (response.status === "incomplete" && response.incomplete_details?.reason === "max_output_tokens") {
        const details = summarizeResponseForTelemetry(response);
        const message = `Post-process error: hit max_output_tokens${details ? ` (${details})` : ""}`;
        lastError = { category: "incomplete_output", message, ...(text ? { raw: text } : {}) };
        if (attemptIndex < expandedAttempts.length - 1) {
          continue;
        }
        break;
      }
      if (!text) {
        const details = summarizeResponseForTelemetry(response);
        const message = `Post-process error: empty output_text${details ? ` (${details})` : ""}`;
        lastError = { category: "incomplete_output", message };
        if (response.incomplete_details?.reason === "max_output_tokens" && attemptIndex < expandedAttempts.length - 1) {
          continue;
        }
        break;
      }

      lastRaw = text;

      let parsed: unknown;
      try {
        parsed = JSON.parse(extractJsonObjectFromText(text));
      } catch (parseError) {
        const details = summarizeResponseForTelemetry(response);
        const msg = `Post-process error: failed to parse JSON (${parseError instanceof Error ? parseError.message : "unknown"})${
          details ? ` (${details})` : ""
        }`;
        lastError = { category: "parse_error", message: msg, raw: text };
        if (attemptIndex < expandedAttempts.length - 1) {
          continue;
        }
        break;
      }

      if (params.validate) {
        const validated = params.validate(parsed);
        if (!validated.success) {
          const msg = `Post-process error: schema violation (${validated.error})`;
          lastError = { category: "schema_violation", message: msg, raw: text };
          if (attemptIndex < expandedAttempts.length - 1) {
            continue;
          }
          break;
        }

        return {
          success: true,
          data: validated.data,
          rawOutput: text,
          telemetry: buildTelemetryBase({
            traceId: params.traceId,
            parentSpanId: params.parentSpanId,
            interactionId,
            promptKey: promptKeyForTelemetry,
            featureId: params.featureId || featureId,
            model: params.model,
            pattern: "structured_json",
            attemptCount: attemptIndex + 1,
          }),
        };
      }

      return {
        success: true,
        data: parsed as T,
        rawOutput: text,
        telemetry: buildTelemetryBase({
          traceId: params.traceId,
          parentSpanId: params.parentSpanId,
          interactionId,
          promptKey: promptKeyForTelemetry,
          featureId: params.featureId || featureId,
          model: params.model,
          pattern: "structured_json",
          attemptCount: attemptIndex + 1,
        }),
      };
    } catch (error) {
      const categorized = categorizePromptRunnerError(error);
      lastRequestError = categorized;
      if (attemptIndex < expandedAttempts.length - 1) {
        continue;
      }

      return {
        success: false,
        error: categorized,
        telemetry: buildTelemetryBase({
          traceId: params.traceId,
          parentSpanId: params.parentSpanId,
          interactionId: lastInteractionId,
          promptKey: promptKeyForTelemetry,
          featureId: params.featureId || featureId,
          model: params.model,
          pattern: "structured_json",
          attemptCount: attemptIndex + 1,
        }),
      };
    }
  }

  if (lastInteractionId && lastError) {
    await markAiInteractionError(lastInteractionId, lastError.message);
  }

  const finalError: PromptRunnerError = lastRequestError
    ? lastRequestError
    : {
        category: (lastError?.category ?? "unknown") satisfies PromptRunnerError["category"],
        message: lastError?.message ?? "Prompt runner failed",
        retryable: false,
        ...(lastError?.raw ? { raw: lastError.raw } : {}),
      };

  return {
    success: false,
    error: finalError,
    ...(lastRaw ? { rawOutput: lastRaw } : {}),
    telemetry: buildTelemetryBase({
      traceId: params.traceId,
      parentSpanId: params.parentSpanId,
      interactionId: lastInteractionId,
      promptKey: promptKeyForTelemetry,
      featureId: params.featureId || featureId,
      model: params.model,
      pattern: "structured_json",
      attemptCount: expandedAttempts.length,
    }),
  };
}

export async function runTextPrompt(params: TextPromptParams): Promise<PromptRunnerResult<string>> {
  const resolved =
    params.resolved ??
    (await resolvePromptTemplate({
      promptKey: params.promptKey,
      clientId: params.clientId,
      systemFallback: params.systemFallback,
      templateVars: params.templateVars,
    }));

  const system = resolved.system;
  const featureId = resolved.featureId;
  const promptKeyForTelemetry = resolved.promptKeyForTelemetry;

  const fallbackMaxOutputTokens =
    typeof params.maxOutputTokens === "number"
      ? Math.max(1, Math.trunc(params.maxOutputTokens))
      : params.budget
        ? (
            await computeAdaptiveMaxOutputTokens({
              model: params.model,
              instructions: system,
              input: params.input,
              min: params.budget.min,
              max: params.budget.max,
              overheadTokens: params.budget.overheadTokens,
              outputScale: params.budget.outputScale,
              preferApiCount: params.budget.preferApiCount,
            })
          ).maxOutputTokens
        : 800;

  const attempts = Array.isArray(params.attempts) && params.attempts.length > 0
    ? normalizeAttempts(params.attempts)
    : [fallbackMaxOutputTokens];

  const envMaxAttempts = getDefaultMaxAttempts();
  const maxAttempts = coerceMaxAttempts(params.maxAttempts, Math.max(attempts.length, envMaxAttempts));
  const multiplier = coerceRetryMultiplier(params.retryOutputTokensMultiplier, getDefaultRetryMultiplier());
  const cap = (() => {
    if (params.budget) {
      const retryMax =
        typeof params.budget.retryMax === "number" && Number.isFinite(params.budget.retryMax)
          ? Math.max(1, Math.trunc(params.budget.retryMax))
          : null;
      if (retryMax) return retryMax;

      const baseMax =
        typeof params.budget.max === "number" && Number.isFinite(params.budget.max)
          ? Math.max(1, Math.trunc(params.budget.max))
          : fallbackMaxOutputTokens;
      return Math.ceil(baseMax * Math.pow(multiplier, Math.max(0, maxAttempts - 1)));
    }

    const baseMax =
      typeof params.maxOutputTokens === "number" && Number.isFinite(params.maxOutputTokens)
        ? Math.max(1, Math.trunc(params.maxOutputTokens))
        : fallbackMaxOutputTokens;
    return Math.ceil(baseMax * Math.pow(multiplier, Math.max(0, maxAttempts - 1)));
  })();

  const expandedAttempts = expandAttemptsWithMultiplier({
    attempts,
    maxAttempts: Math.max(attempts.length, maxAttempts),
    multiplier,
    cap: Math.max(cap, ...attempts),
  });

  const temperature = typeof params.temperature === "number" && Number.isFinite(params.temperature) ? params.temperature : null;

  const retryOn = Array.isArray(params.retryOn) && params.retryOn.length
    ? new Set(params.retryOn)
    : new Set<PromptRunnerError["category"]>(["timeout", "rate_limit", "api_error"]);

  let lastInteractionId: string | null = null;
  let lastError: { category: "incomplete_output"; message: string; raw?: string } | null = null;
  let lastRaw: string | null = null;

  for (let attemptIndex = 0; attemptIndex < expandedAttempts.length; attemptIndex++) {
    const maxOutputTokens = expandedAttempts[attemptIndex]!;
    const attemptSuffix = attemptIndex === 0 ? "" : `.retry${attemptIndex + 1}`;
    const effort =
      attemptIndex > 0 && params.retryReasoningEffort ? params.retryReasoningEffort : params.reasoningEffort;

    try {
      const { response, interactionId } = await runResponseWithInteraction({
        clientId: params.clientId,
        leadId: params.leadId,
        source: params.source,
        featureId: params.featureId || featureId,
        promptKey: promptKeyForTelemetry + attemptSuffix,
        params: {
          model: params.model,
          ...resolveTemperatureAndReasoning({ model: params.model, temperature, reasoningEffort: effort ?? null }),
          max_output_tokens: maxOutputTokens,
          instructions: system,
          ...(params.verbosity ? { text: { verbosity: params.verbosity } } : {}),
          input: params.input,
        } satisfies OpenAI.Responses.ResponseCreateParamsNonStreaming,
        requestOptions: (() => {
          const timeout =
            typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
              ? Math.trunc(params.timeoutMs)
              : null;
          const maxRetries =
            typeof params.maxRetries === "number" && Number.isFinite(params.maxRetries)
              ? Math.max(0, Math.trunc(params.maxRetries))
              : null;
          return {
            ...(typeof timeout === "number" && timeout > 0 ? { timeout } : {}),
            ...(typeof maxRetries === "number" ? { maxRetries } : {}),
          };
        })(),
      });

      lastInteractionId = interactionId;

      const text = getTrimmedOutputText(response);
      if (response.status === "incomplete" && response.incomplete_details?.reason === "max_output_tokens") {
        const details = summarizeResponseForTelemetry(response);
        const msg = `Post-process error: hit max_output_tokens${details ? ` (${details})` : ""}`;
        lastError = { category: "incomplete_output", message: msg, ...(text ? { raw: text } : {}) };
        if (attemptIndex < expandedAttempts.length - 1) {
          continue;
        }
        break;
      }
      if (!text) {
        const details = summarizeResponseForTelemetry(response);
        const msg = `Post-process error: empty output_text${details ? ` (${details})` : ""}`;
        lastError = { category: "incomplete_output", message: msg };
        if (response.incomplete_details?.reason === "max_output_tokens" && attemptIndex < expandedAttempts.length - 1) {
          continue;
        }
        break;
      }

      lastRaw = text;

      return {
        success: true,
        data: text,
        rawOutput: text,
        telemetry: buildTelemetryBase({
          traceId: params.traceId,
          parentSpanId: params.parentSpanId,
          interactionId,
          promptKey: promptKeyForTelemetry,
          featureId: params.featureId || featureId,
          model: params.model,
          pattern: "text",
          attemptCount: attemptIndex + 1,
        }),
      };
    } catch (error) {
      const categorized = categorizePromptRunnerError(error);
      if (categorized.retryable && retryOn.has(categorized.category) && attemptIndex < expandedAttempts.length - 1) {
        continue;
      }

      return {
        success: false,
        error: categorized,
        telemetry: buildTelemetryBase({
          traceId: params.traceId,
          parentSpanId: params.parentSpanId,
          interactionId: null,
          promptKey: promptKeyForTelemetry,
          featureId: params.featureId || featureId,
          model: params.model,
          pattern: "text",
          attemptCount: attemptIndex + 1,
        }),
      };
    }
  }

  if (lastInteractionId && lastError) {
    await markAiInteractionError(lastInteractionId, lastError.message);
  }

  return {
    success: false,
    error: {
      category: "incomplete_output",
      message: lastError?.message ?? "Prompt runner failed",
      retryable: false,
      ...(lastError?.raw ? { raw: lastError.raw } : {}),
    },
    ...(lastRaw ? { rawOutput: lastRaw } : {}),
    telemetry: buildTelemetryBase({
      traceId: params.traceId,
      parentSpanId: params.parentSpanId,
      interactionId: lastInteractionId,
      promptKey: promptKeyForTelemetry,
      featureId: params.featureId || featureId,
      model: params.model,
      pattern: "text",
      attemptCount: expandedAttempts.length,
    }),
  };
}
