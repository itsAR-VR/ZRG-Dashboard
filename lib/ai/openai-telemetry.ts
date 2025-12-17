import "server-only";

import "@/lib/server-dns";
import OpenAI from "openai";
import { prisma } from "@/lib/prisma";
import { estimateCostUsd } from "@/lib/ai/pricing";
import { pruneOldAIInteractionsMaybe } from "@/lib/ai/retention";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type UsageSnapshot = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  totalTokens?: number | null;
};

function extractUsageFromChatCompletion(resp: any): UsageSnapshot {
  const usage = resp?.usage;
  if (!usage) return {};
  return {
    inputTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
    outputTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
    totalTokens: typeof usage.total_tokens === "number" ? usage.total_tokens : null,
  };
}

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

async function recordInteraction(opts: {
  clientId: string;
  leadId?: string | null;
  featureId: string;
  promptKey?: string | null;
  model: string;
  apiType: "responses" | "chat_completions";
  usage: UsageSnapshot;
  latencyMs: number;
  status: "success" | "error";
  errorMessage?: string | null;
}): Promise<void> {
  const costUsd = estimateCostUsd({
    model: opts.model,
    inputTokens: opts.usage.inputTokens,
    outputTokens: opts.usage.outputTokens,
  });

  await prisma.aIInteraction.create({
    data: {
      clientId: opts.clientId,
      leadId: opts.leadId || null,
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
    },
  });

  // Keep the table bounded (best-effort).
  await pruneOldAIInteractionsMaybe();
}

export async function runChatCompletion(opts: {
  clientId: string;
  leadId?: string | null;
  featureId: string;
  promptKey?: string | null;
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
}): Promise<OpenAI.Chat.ChatCompletion> {
  const start = Date.now();
  try {
    const resp = await openai.chat.completions.create(opts.params);
    const latencyMs = Date.now() - start;
    const usage = extractUsageFromChatCompletion(resp);

    try {
      await recordInteraction({
        clientId: opts.clientId,
        leadId: opts.leadId,
        featureId: opts.featureId,
        promptKey: opts.promptKey,
        model: String(opts.params.model),
        apiType: "chat_completions",
        usage,
        latencyMs,
        status: "success",
      });
    } catch (logError) {
      console.error("[AI Telemetry] Failed to record chat interaction:", logError);
    }

    return resp;
  } catch (error) {
    const latencyMs = Date.now() - start;
    const message = error instanceof Error ? error.message : "Unknown error";

    try {
      await recordInteraction({
        clientId: opts.clientId,
        leadId: opts.leadId,
        featureId: opts.featureId,
        promptKey: opts.promptKey,
        model: String(opts.params.model),
        apiType: "chat_completions",
        usage: {},
        latencyMs,
        status: "error",
        errorMessage: message,
      });
    } catch (logError) {
      console.error("[AI Telemetry] Failed to record chat error:", logError);
    }

    throw error;
  }
}

export async function runResponse(opts: {
  clientId: string;
  leadId?: string | null;
  featureId: string;
  promptKey?: string | null;
  params: OpenAI.Responses.ResponseCreateParamsNonStreaming;
}): Promise<OpenAI.Responses.Response> {
  const start = Date.now();
  try {
    const resp = await openai.responses.create(opts.params);
    const latencyMs = Date.now() - start;
    const usage = extractUsageFromResponseApi(resp);

    try {
      await recordInteraction({
        clientId: opts.clientId,
        leadId: opts.leadId,
        featureId: opts.featureId,
        promptKey: opts.promptKey,
        model: String(opts.params.model),
        apiType: "responses",
        usage,
        latencyMs,
        status: "success",
      });
    } catch (logError) {
      console.error("[AI Telemetry] Failed to record response interaction:", logError);
    }

    return resp;
  } catch (error) {
    const latencyMs = Date.now() - start;
    const message = error instanceof Error ? error.message : "Unknown error";

    try {
      await recordInteraction({
        clientId: opts.clientId,
        leadId: opts.leadId,
        featureId: opts.featureId,
        promptKey: opts.promptKey,
        model: String(opts.params.model),
        apiType: "responses",
        usage: {},
        latencyMs,
        status: "error",
        errorMessage: message,
      });
    } catch (logError) {
      console.error("[AI Telemetry] Failed to record response error:", logError);
    }

    throw error;
  }
}
