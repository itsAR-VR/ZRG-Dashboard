# Phase 51d — Unified AI Prompt Runner: Full Migration + Agentic Architecture

## Focus

Build a production-grade, agentic-ready prompt runner that unifies ALL AI call sites (15+) with comprehensive observability, error categorization, and composability for multi-step workflows. This is foundational infrastructure for scaling AI automation.

## Design Philosophy

**Think like a veteran building agentic infrastructure:**
- One execution path = one place for bugs, one place for improvements
- Observability first: you can't fix what you can't see
- Composable primitives: simple building blocks that combine into complex flows
- Fail gracefully with categorized errors: callers should know *why* it failed
- Future-proof: support reasoning models (o1/o3), streaming, and multi-agent coordination

## Inputs

- Group C findings in `docs/audits/structural-duplication-2026-01-22.md`
- All current AI call sites (15+ files):
  - **Structured JSON output**: `auto-send-evaluator`, `auto-reply-gate`, `followup-engine`, `timezone-inference`, `signature-extractor`, `lead-scoring`, `knowledge-asset-extraction`
  - **Draft generation**: `ai-drafts.ts` (multi-step with step-3 verifier)
  - **Classification**: `sentiment.ts`
  - **Insights/RAG**: `insights-chat/*` (chat-answer, pack-synthesis, thread-extractor, eval)
- Existing plumbing:
  - `lib/ai/prompt-registry.ts:getPromptWithOverrides(...)`
  - `lib/ai/openai-telemetry.ts:runResponseWithInteraction`, `markAiInteractionError`
  - `lib/ai/adaptive-tokens.ts:computeAdaptiveMaxOutputTokens`

## Pre-Flight (RED TEAM)

- [ ] Confirm working tree is clean (subphase c completed and committed).
- [ ] Grep `runResponse` / `runResponseWithInteraction` to build complete call site inventory.
- [ ] Categorize each call site by pattern: structured JSON, reasoning, streaming, multi-step.
- [ ] Read Phase 49 step-3 verifier to understand draft generation's multi-step flow.

## Architecture

### Core Abstractions

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// lib/ai/prompt-runner/types.ts — Core type definitions
// ═══════════════════════════════════════════════════════════════════════════

/** Supported AI execution patterns */
type AIExecutionPattern =
  | "structured_json"      // JSON schema response (most common)
  | "reasoning"            // o1/o3 reasoning models
  | "streaming"            // SSE streaming responses
  | "multi_step";          // Chained calls with intermediate state

/** Error categories for observability and retry decisions */
type AIErrorCategory =
  | "timeout"              // Request timed out
  | "rate_limit"           // 429 from API
  | "api_error"            // 5xx from API
  | "parse_error"          // Valid response but malformed JSON
  | "incomplete_output"    // Truncated due to token limit
  | "schema_violation"     // JSON doesn't match expected schema
  | "content_filter"       // Blocked by safety filters
  | "cancelled"            // Aborted by caller
  | "unknown";             // Unexpected failure

/** Telemetry span for observability */
interface AITelemetrySpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  promptKey: string;
  featureId: string;
  model: string;
  pattern: AIExecutionPattern;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  status: "running" | "success" | "error";
  errorCategory?: AIErrorCategory;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

/** Base params for all prompt runner calls */
interface PromptRunnerBaseParams {
  clientId: string;
  leadId?: string;
  promptKey: string;
  templateVars?: Record<string, string>;
  featureId: string;              // Required: identifies the calling feature
  model?: string;                 // Default: from env or feature config
  timeoutMs?: number;             // Default: from env OPENAI_TIMEOUT_MS
  maxOutputTokens?: number;       // Default: computed adaptively
  parentSpanId?: string;          // For multi-step tracing
  abortSignal?: AbortSignal;      // For cancellation
}

/** Params for structured JSON output */
interface StructuredJsonParams<T> extends PromptRunnerBaseParams {
  pattern: "structured_json";
  schema: JsonSchema;
  strictSchema?: boolean;         // Default: true
}

/** Params for reasoning models */
interface ReasoningParams extends PromptRunnerBaseParams {
  pattern: "reasoning";
  reasoningEffort?: "low" | "medium" | "high";
  schema?: JsonSchema;            // Optional: structured output from reasoning
}

/** Params for streaming responses */
interface StreamingParams extends PromptRunnerBaseParams {
  pattern: "streaming";
  onChunk: (chunk: string) => void;
  onComplete?: (fullText: string) => void;
}

/** Unified result type */
interface PromptRunnerResult<T = unknown> {
  success: boolean;
  data?: T;
  rawOutput?: string;
  error?: {
    category: AIErrorCategory;
    message: string;
    retryable: boolean;
    raw?: string;
  };
  telemetry: AITelemetrySpan;
}
```

### Module Structure

```
lib/ai/prompt-runner/
├── index.ts              # Public exports
├── types.ts              # Type definitions (above)
├── runner.ts             # Core execution logic
├── patterns/
│   ├── structured-json.ts   # JSON schema pattern
│   ├── reasoning.ts         # o1/o3 reasoning pattern
│   └── streaming.ts         # SSE streaming pattern
├── telemetry.ts          # Span management, AIInteraction persistence
├── errors.ts             # Error categorization and retry logic
├── template.ts           # Template variable substitution
└── __tests__/
    ├── runner.test.ts
    ├── structured-json.test.ts
    ├── reasoning.test.ts
    └── errors.test.ts
```

### Core Runner Implementation

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// lib/ai/prompt-runner/runner.ts — Core execution
// ═══════════════════════════════════════════════════════════════════════════

import { getPromptWithOverrides } from "../prompt-registry";
import { computeAdaptiveMaxOutputTokens } from "../adaptive-tokens";
import { createTelemetrySpan, finishSpan, persistSpan } from "./telemetry";
import { categorizeError, isRetryable } from "./errors";
import { substituteTemplateVars } from "./template";

/**
 * Unified prompt runner — single execution path for all AI calls.
 *
 * @example Structured JSON output
 * const result = await runPrompt<SentimentResult>({
 *   pattern: "structured_json",
 *   clientId,
 *   promptKey: "sentiment_classification",
 *   featureId: "sentiment",
 *   schema: sentimentSchema,
 *   templateVars: { conversation: transcript },
 * });
 *
 * @example Reasoning model
 * const result = await runPrompt({
 *   pattern: "reasoning",
 *   clientId,
 *   promptKey: "complex_analysis",
 *   featureId: "lead_scoring",
 *   reasoningEffort: "medium",
 * });
 */
export async function runPrompt<T = unknown>(
  params: StructuredJsonParams<T> | ReasoningParams | StreamingParams
): Promise<PromptRunnerResult<T>> {

  // 1. Create telemetry span (generates traceId/spanId)
  const span = createTelemetrySpan({
    promptKey: params.promptKey,
    featureId: params.featureId,
    model: params.model ?? getDefaultModel(params.pattern),
    pattern: params.pattern,
    parentSpanId: params.parentSpanId,
  });

  try {
    // 2. Resolve prompt with workspace overrides
    const { systemPrompt, overrideVersion } = await getPromptWithOverrides(
      params.clientId,
      params.promptKey
    );

    // 3. Substitute template variables
    const finalPrompt = substituteTemplateVars(systemPrompt, params.templateVars);

    // 4. Compute adaptive token budget
    const maxTokens = params.maxOutputTokens ?? computeAdaptiveMaxOutputTokens({
      promptKey: params.promptKey,
      inputLength: finalPrompt.length,
    });

    // 5. Dispatch to pattern-specific handler
    let result: PromptRunnerResult<T>;

    switch (params.pattern) {
      case "structured_json":
        result = await executeStructuredJson<T>(params, finalPrompt, maxTokens, span);
        break;
      case "reasoning":
        result = await executeReasoning<T>(params, finalPrompt, maxTokens, span);
        break;
      case "streaming":
        result = await executeStreaming(params, finalPrompt, maxTokens, span) as PromptRunnerResult<T>;
        break;
      default:
        throw new Error(`Unknown pattern: ${(params as any).pattern}`);
    }

    // 6. Finish and persist telemetry
    finishSpan(span, result.success ? "success" : "error", result.error);
    await persistSpan(span, params.clientId, params.leadId);

    return result;

  } catch (error) {
    // 7. Categorize unexpected errors
    const categorized = categorizeError(error);
    finishSpan(span, "error", categorized);
    await persistSpan(span, params.clientId, params.leadId);

    return {
      success: false,
      error: categorized,
      telemetry: span,
    };
  }
}

/**
 * Multi-step execution helper for chained AI calls.
 * Maintains trace context across steps.
 */
export async function runPromptChain<T>(
  steps: Array<(parentSpanId: string) => Promise<PromptRunnerResult<unknown>>>,
  options: { clientId: string; featureId: string }
): Promise<PromptRunnerResult<T>> {
  const traceId = generateTraceId();
  let lastResult: PromptRunnerResult<unknown> | null = null;

  for (const step of steps) {
    lastResult = await step(traceId);
    if (!lastResult.success) {
      return lastResult as PromptRunnerResult<T>;
    }
  }

  return lastResult as PromptRunnerResult<T>;
}
```

## Work

### Phase 1: Core Infrastructure (lib/ai/prompt-runner/)

1. **Create type definitions** (`types.ts`):
   - All interfaces from Architecture section above
   - Export everything needed by call sites

2. **Implement telemetry** (`telemetry.ts`):
   - `createTelemetrySpan()` — generates traceId/spanId, initializes timing
   - `finishSpan()` — calculates duration, sets final status
   - `persistSpan()` — writes to AIInteraction table (preserves existing schema)
   - Ensure `promptKey` includes override version suffix for observability

3. **Implement error categorization** (`errors.ts`):
   - `categorizeError(error: unknown): CategorizedError`
   - Map OpenAI error codes to categories
   - `isRetryable(category: AIErrorCategory): boolean`
   - Detect truncation via `finish_reason: "length"` or incomplete JSON

4. **Implement template substitution** (`template.ts`):
   - `substituteTemplateVars(prompt: string, vars?: Record<string, string>): string`
   - Handle `{variable}` placeholders
   - Warn on missing variables (don't fail)

5. **Implement pattern handlers**:
   - `patterns/structured-json.ts` — JSON schema with strict mode
   - `patterns/reasoning.ts` — o1/o3 with reasoning_effort
   - `patterns/streaming.ts` — SSE with chunk callbacks

6. **Implement core runner** (`runner.ts`):
   - `runPrompt<T>()` — single entry point
   - `runPromptChain<T>()` — multi-step helper

### Phase 2: Migration (by call site category)

**Category A: Structured JSON (straightforward migration)**
- [ ] `lib/auto-send-evaluator.ts` — confidence scoring
- [ ] `lib/auto-reply-gate.ts` — reply decision
- [ ] `lib/followup-engine.ts` — `detectMeetingAcceptedIntent`, `parseAcceptedTimeFromMessage`
- [ ] `lib/timezone-inference.ts` — timezone detection
- [ ] `lib/signature-extractor.ts` — signature parsing
- [ ] `lib/lead-scoring.ts` — lead quality scoring
- [ ] `lib/knowledge-asset-extraction.ts` — asset extraction

**Category B: Classification (similar to structured JSON)**
- [ ] `lib/sentiment.ts` — sentiment classification

**Category C: Draft Generation (multi-step)**
- [ ] `lib/ai-drafts.ts` — Use `runPromptChain()` to preserve step-3 verifier flow
  - Step 1: Generate draft
  - Step 2: (email only) Run step-3 verification
  - Step 3: Apply sanitization

**Category D: Insights/RAG (streaming + special handling)**
- [ ] `lib/insights-chat/chat-answer.ts` — streaming responses
- [ ] `lib/insights-chat/pack-synthesis.ts` — may need streaming
- [ ] `lib/insights-chat/thread-extractor.ts` — structured extraction
- [ ] `lib/insights-chat/eval.ts` — evaluation calls

### Phase 3: Verification & Cleanup

1. **Remove dead code**:
   - Inline `runResponseWithInteraction` calls replaced by `runPrompt`
   - Duplicated error handling/parsing logic

2. **Update telemetry queries**:
   - Ensure dashboards/alerts still work with new span format
   - Add new trace-based queries for multi-step flows

3. **Regression tests**:
   - Unit tests for each pattern handler
   - Integration tests comparing old vs new output for same inputs
   - Telemetry assertion: AIInteraction rows match expected schema

## Validation (RED TEAM)

### Automated
- [ ] `npm run lint` — no errors
- [ ] `npm run build` — no type errors
- [ ] `npm run test` — all tests pass (existing + new)

### Manual Smoke Tests
- [ ] **Structured JSON**: Trigger auto-send evaluation → verify JSON parsed, telemetry logged
- [ ] **Reasoning**: Trigger lead scoring (if using reasoning) → verify reasoning tokens logged
- [ ] **Streaming**: Open insights chat → verify streaming works, telemetry captures full duration
- [ ] **Multi-step**: Trigger email draft generation → verify both steps traced with same traceId
- [ ] **Error handling**: Simulate timeout → verify categorized error returned, retryable=true
- [ ] **Prompt override**: Set override → verify `promptKey` suffix in telemetry

### Observability
- [ ] AIInteraction rows have correct `featureId`, `promptKey`, token counts
- [ ] No PII in logs (only promptKey + input length, not content)
- [ ] Trace IDs enable correlation across multi-step flows

## Output

### Implemented

- Added `lib/ai/prompt-runner/`:
  - `runStructuredJsonPrompt()` + `runTextPrompt()` (Responses API via existing `runResponseWithInteraction`)
  - Prompt override resolution via `resolvePromptTemplate()` (`getPromptWithOverrides` + registry fallback)
  - `{var}` + `{{var}}` template variable substitution
  - Adaptive token budgeting + optional retries (`attempts` or `retryMax`/`retryExtraTokens` knobs)
  - Standardized error categorization (`timeout`, `rate_limit`, `api_error`, `parse_error`, `schema_violation`, `incomplete_output`, `unknown`)
  - Telemetry payload returned to callers: `traceId`, `spanId` (= interactionId), `promptKey`, `featureId`, `model`, `pattern`, `attemptCount`
  - Pass-through support for `temperature` and text `verbosity` (when provided)

- Migrated remaining AI call sites off direct `runResponse` / `runResponseWithInteraction` usage:
  - `lib/ai-drafts.ts` (strategy JSON, generation, length rewrite, fallback, step-3 verifier)
  - `lib/followup-engine.ts` (meeting acceptance intent + accepted-time parsing)
  - `lib/insights-chat/thread-extractor.ts` (chunk compression + full-thread extraction)
  - `lib/knowledge-asset-extraction.ts` (text/PDF/image knowledge notes extraction)

- Inventory check: `runResponseWithInteraction`/`runResponse` usage now lives only inside `lib/ai/prompt-runner/runner.ts`.

### Notes / Gaps

- Prompt runner v1 unifies **structured JSON** + **text** patterns; no streaming abstraction was added in this phase.
- Repo was already dirty from prior phases; merged changes semantically and documented in earlier subphases.

## Handoff

Subphase e runs full validation across all refactored modules and prepares rollout checklist.

## Why This Architecture (Design Rationale)

### Single Execution Path
Every AI call goes through `runPrompt()`. This means:
- One place to add rate limiting
- One place to add circuit breakers
- One place to fix parsing bugs
- One place to upgrade to new models

### Trace-Based Telemetry
OpenTelemetry-style spans enable:
- Correlating multi-step flows (draft generation + verification)
- Understanding latency breakdown
- Debugging production issues by traceId
- Future: distributed tracing across services

### Error Categorization
Knowing *why* a call failed enables:
- Smart retry logic (retry rate_limit, don't retry parse_error)
- Accurate alerting (alert on api_error spike, not on expected timeouts)
- User-facing error messages that make sense

### Pattern Separation
Different AI patterns have different:
- Token budgets (reasoning uses reasoning_tokens)
- Response handling (streaming needs chunk callbacks)
- Timeout requirements (reasoning may take longer)

Keeping patterns separate allows optimization without cross-contamination.
