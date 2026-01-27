import "server-only";

import type OpenAI from "openai";

export type AIExecutionPattern = "structured_json" | "text";

export type AIErrorCategory =
  | "timeout"
  | "rate_limit"
  | "api_error"
  | "parse_error"
  | "incomplete_output"
  | "schema_violation"
  | "unknown";

export type PromptRunnerError = {
  category: AIErrorCategory;
  message: string;
  retryable: boolean;
  raw?: string;
};

export type PromptRunnerTelemetry = {
  traceId: string;
  spanId: string | null;
  parentSpanId?: string | null;
  interactionId: string | null;
  promptKey: string;
  featureId: string;
  model: string;
  pattern: AIExecutionPattern;
  attemptCount: number;
};

export type ResolvedPromptMetadata = {
  system: string;
  featureId: string;
  promptKeyForTelemetry: string;
};

export type PromptBudgetParams = {
  min: number;
  max: number;
  retryMax?: number;
  retryMinBaseTokens?: number;
  retryExtraTokens?: number;
  overheadTokens?: number;
  outputScale?: number;
  preferApiCount?: boolean;
};

export type PromptRunnerBaseParams = {
  clientId: string;
  leadId?: string | null;
  source?: string | null;
  promptKey: string;
  featureId?: string;
  model: string;
  systemFallback: string;
  templateVars?: Record<string, string>;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  temperature?: number;
  timeoutMs?: number;
  maxRetries?: number;
  traceId?: string;
  parentSpanId?: string | null;
  resolved?: ResolvedPromptMetadata;
};

export type StructuredJsonPromptParams<T> = PromptRunnerBaseParams & {
  pattern: "structured_json";
  input: OpenAI.Responses.ResponseCreateParamsNonStreaming["input"];
  schemaName: string;
  schema: Record<string, unknown>;
  strict?: boolean;
  verbosity?: "low" | "medium" | "high";
  budget: PromptBudgetParams;
  attempts?: number[];
  validate?: (value: unknown) => { success: true; data: T } | { success: false; error: string };
};

export type TextPromptParams = PromptRunnerBaseParams & {
  pattern: "text";
  input: OpenAI.Responses.ResponseCreateParamsNonStreaming["input"];
  budget?: PromptBudgetParams;
  maxOutputTokens?: number;
  attempts?: number[];
  retryOn?: AIErrorCategory[];
  retryReasoningEffort?: PromptRunnerBaseParams["reasoningEffort"];
  verbosity?: "low" | "medium" | "high";
};

export type PromptRunnerResult<T> =
  | {
      success: true;
      data: T;
      rawOutput: string;
      telemetry: PromptRunnerTelemetry;
    }
  | {
      success: false;
      error: PromptRunnerError;
      rawOutput?: string;
      telemetry: PromptRunnerTelemetry;
    };
