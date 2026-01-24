import "server-only";

import { randomUUID } from "node:crypto";
import type OpenAI from "openai";

import { computeAdaptiveMaxOutputTokens } from "@/lib/ai/token-budget";
import { markAiInteractionError, runResponseWithInteraction } from "@/lib/ai/openai-telemetry";
import { extractJsonObjectFromText, getTrimmedOutputText, summarizeResponseForTelemetry } from "@/lib/ai/response-utils";
import { categorizePromptRunnerError } from "@/lib/ai/prompt-runner/errors";
import { resolvePromptTemplate } from "@/lib/ai/prompt-runner/resolve";
import type { PromptRunnerError, PromptRunnerResult, StructuredJsonPromptParams, TextPromptParams } from "@/lib/ai/prompt-runner/types";

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

  const attempts: number[] = Array.isArray(params.attempts) && params.attempts.length > 0 ? normalizeAttempts(params.attempts) : [];

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

    const retryMax =
      typeof params.budget.retryMax === "number" && Number.isFinite(params.budget.retryMax) ? Math.trunc(params.budget.retryMax) : null;
    if (retryMax && retryMax > budget.maxOutputTokens) {
      const retryMinBase =
        typeof params.budget.retryMinBaseTokens === "number" && Number.isFinite(params.budget.retryMinBaseTokens)
          ? Math.max(1, Math.trunc(params.budget.retryMinBaseTokens))
          : 512;
      const retryExtra =
        typeof params.budget.retryExtraTokens === "number" && Number.isFinite(params.budget.retryExtraTokens)
          ? Math.max(0, Math.trunc(params.budget.retryExtraTokens))
          : 400;
      const retryBudgetBase = Math.max(budget.maxOutputTokens, retryMinBase);
      const retryTokens = Math.min(retryBudgetBase + retryExtra, retryMax);
      if (retryTokens > budget.maxOutputTokens) {
        attempts.push(retryTokens);
      }
    }
  }

  let lastInteractionId: string | null = null;
  let lastError: { category: "parse_error" | "schema_violation" | "incomplete_output"; message: string; raw?: string } | null = null;
  let lastRaw: string | null = null;
  let lastRequestError: ReturnType<typeof categorizePromptRunnerError> | null = null;

  for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
    const maxOutputTokens = attempts[attemptIndex]!;
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
          ...(typeof params.temperature === "number" && Number.isFinite(params.temperature) ? { temperature: params.temperature } : {}),
          ...(params.reasoningEffort ? { reasoning: { effort: params.reasoningEffort } } : {}),
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
        requestOptions: {
          timeout: params.timeoutMs,
          maxRetries: typeof params.maxRetries === "number" ? params.maxRetries : undefined,
        },
      });

      lastInteractionId = interactionId;

      const text = getTrimmedOutputText(response);
      if (response.status === "incomplete" && response.incomplete_details?.reason === "max_output_tokens") {
        const details = summarizeResponseForTelemetry(response);
        const message = `Post-process error: hit max_output_tokens${details ? ` (${details})` : ""}`;
        lastError = { category: "incomplete_output", message, ...(text ? { raw: text } : {}) };
        if (attemptIndex < attempts.length - 1) {
          continue;
        }
        break;
      }
      if (!text) {
        const details = summarizeResponseForTelemetry(response);
        const message = `Post-process error: empty output_text${details ? ` (${details})` : ""}`;
        lastError = { category: "incomplete_output", message };
        if (response.incomplete_details?.reason === "max_output_tokens" && attemptIndex < attempts.length - 1) {
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
        if (attemptIndex < attempts.length - 1) {
          continue;
        }
        break;
      }

      if (params.validate) {
        const validated = params.validate(parsed);
        if (!validated.success) {
          const msg = `Post-process error: schema violation (${validated.error})`;
          lastError = { category: "schema_violation", message: msg, raw: text };
          if (attemptIndex < attempts.length - 1) {
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
      if (attemptIndex < attempts.length - 1) {
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
      attemptCount: attempts.length,
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

  const maxOutputTokens =
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

  try {
    const { response, interactionId } = await runResponseWithInteraction({
      clientId: params.clientId,
      leadId: params.leadId,
      source: params.source,
      featureId: params.featureId || featureId,
      promptKey: promptKeyForTelemetry,
      params: {
        model: params.model,
        ...(typeof params.temperature === "number" && Number.isFinite(params.temperature) ? { temperature: params.temperature } : {}),
        ...(params.reasoningEffort ? { reasoning: { effort: params.reasoningEffort } } : {}),
        max_output_tokens: maxOutputTokens,
        instructions: system,
        ...(params.verbosity ? { text: { verbosity: params.verbosity } } : {}),
        input: params.input,
      } satisfies OpenAI.Responses.ResponseCreateParamsNonStreaming,
      requestOptions: {
        timeout: params.timeoutMs,
        maxRetries: typeof params.maxRetries === "number" ? params.maxRetries : undefined,
      },
    });

    const text = getTrimmedOutputText(response);
    if (response.status === "incomplete" && response.incomplete_details?.reason === "max_output_tokens") {
      const details = summarizeResponseForTelemetry(response);
      const msg = `Post-process error: hit max_output_tokens${details ? ` (${details})` : ""}`;
      if (interactionId) await markAiInteractionError(interactionId, msg);
      return {
        success: false,
        error: { category: "incomplete_output", message: msg, retryable: false, ...(text ? { raw: text } : {}) },
        ...(text ? { rawOutput: text } : {}),
        telemetry: buildTelemetryBase({
          traceId: params.traceId,
          parentSpanId: params.parentSpanId,
          interactionId,
          promptKey: promptKeyForTelemetry,
          featureId: params.featureId || featureId,
          model: params.model,
          pattern: "text",
          attemptCount: 1,
        }),
      };
    }
    if (!text) {
      const details = summarizeResponseForTelemetry(response);
      const msg = `Post-process error: empty output_text${details ? ` (${details})` : ""}`;
      if (interactionId) await markAiInteractionError(interactionId, msg);
      return {
        success: false,
        error: { category: "incomplete_output", message: msg, retryable: false },
        telemetry: buildTelemetryBase({
          traceId: params.traceId,
          parentSpanId: params.parentSpanId,
          interactionId,
          promptKey: promptKeyForTelemetry,
          featureId: params.featureId || featureId,
          model: params.model,
          pattern: "text",
          attemptCount: 1,
        }),
      };
    }

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
        attemptCount: 1,
      }),
    };
  } catch (error) {
    const categorized = categorizePromptRunnerError(error);
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
        attemptCount: 1,
      }),
    };
  }
}
