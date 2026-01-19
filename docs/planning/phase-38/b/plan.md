# Phase 38b — Add Retry Logic for Truncated Strategy JSON

## Focus
Add a retry loop around the email draft strategy step that increases `max_output_tokens` when truncation is detected, following the pattern established in `lib/lead-scoring.ts`.

## Inputs
- Modified `parseStrategyJson` from 38a (returns `{ strategy, status, rawText? }`)
- `lib/ai-drafts.ts` strategy generation code (lines 859-936)
- Pattern from `lib/lead-scoring.ts` retry loop (lines 255-358)

## Work

### 1. Extract strategy generation into a retry loop

**Current flow** (lines 859-936):
```typescript
// Step 1: Strategy (single attempt)
let strategy: EmailDraftStrategy | null = null;
let strategyInteractionId: string | null = null;
// ... setup code ...

try {
  const { response: strategyResponse, interactionId } = await runResponseWithInteraction({
    // ... params with max_output_tokens: 1500 ...
  });

  strategyInteractionId = interactionId;
  const strategyText = getTrimmedOutputText(strategyResponse)?.trim();
  strategy = parseStrategyJson(strategyText);

  if (!strategy && strategyInteractionId) {
    await markAiInteractionError(strategyInteractionId, "strategy_parse_failed: ...");
  }
} catch (error) {
  console.error("[AI Drafts] Step 1 (Strategy) failed:", error);
}
```

**Target flow**:
```typescript
// Step 1: Strategy (with retry on truncation)
let strategy: EmailDraftStrategy | null = null;
let strategyInteractionId: string | null = null;
const strategyMaxRetries = 2;
const strategyBaseTokens = 1500;

for (let attempt = 1; attempt <= strategyMaxRetries; attempt++) {
  try {
    const attemptMaxTokens = strategyBaseTokens + (attempt - 1) * 500; // +500 tokens per retry
    const attemptTimeout = strategyTimeoutMs + (attempt - 1) * 3000; // +3s per retry

    const { response: strategyResponse, interactionId } = await runResponseWithInteraction({
      // ... params ...
      max_output_tokens: attemptMaxTokens,
      // ... rest of params ...
      requestOptions: {
        timeout: attemptTimeout,
        maxRetries: 0,
      },
    });

    strategyInteractionId = interactionId;
    const strategyText = getTrimmedOutputText(strategyResponse)?.trim();
    const parseResult = parseStrategyJson(strategyText);

    if (parseResult.status === "complete" && parseResult.strategy) {
      strategy = parseResult.strategy;
      break; // Success - exit retry loop
    }

    if (parseResult.status === "incomplete") {
      console.warn(
        `[AI Drafts] Strategy JSON truncated (attempt ${attempt}/${strategyMaxRetries}), retrying with more tokens`
      );
      if (attempt < strategyMaxRetries) continue;
    }

    // Log failure on final attempt
    if (attempt === strategyMaxRetries && strategyInteractionId) {
      const errorDetail = parseResult.status === "incomplete"
        ? "strategy_truncated: JSON truncated after retries"
        : `strategy_parse_failed: ${parseResult.status}`;
      await markAiInteractionError(strategyInteractionId, errorDetail);
    }
  } catch (error) {
    console.error(`[AI Drafts] Step 1 (Strategy) attempt ${attempt} failed:`, error);
    if (attempt === strategyMaxRetries) break;
    // Exponential backoff between retries
    await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
  }
}
```

### 2. Constants and configuration

Add configurable retry parameters:
- `OPENAI_STRATEGY_MAX_RETRIES` env var (default: 2)
- `OPENAI_STRATEGY_BASE_TOKENS` env var (default: 1500)
- `OPENAI_STRATEGY_TOKEN_INCREMENT` env var (default: 500)

### 3. Preserve timeout budget

The retry loop must respect the overall timeout budget:
- `strategyTimeoutMs` is already ~40% of total `timeoutMs`
- Each retry attempt gets slightly more time but must not exceed budget
- If budget exhausted, fall through to single-step fallback

## Output
**Completed 2026-01-19**

- Wrapped Step 1 (email strategy) in a retry loop with truncation-aware parsing; retries trigger on `parseStrategyJson` non-`complete` results.
- Increased token headroom per your requirement: starts at `2000` and ramps up to a cap of `5000` (`OPENAI_EMAIL_STRATEGY_BASE_MAX_OUTPUT_TOKENS`, `OPENAI_EMAIL_STRATEGY_MAX_OUTPUT_TOKENS`).
- Added attempt-specific `promptKey` suffixes (`.retry2`, `.retry3`, …) for telemetry attribution.
- Kept retry latency minimal (immediate retry; only a tiny delay on HTTP 429).
- Timeboxed retries to stay within the strategy timeout budget (doesn’t blow the overall request timeout).

## Handoff
Subphase 38c will:
1. Add enhanced telemetry to capture raw response text on failures
2. Update error messages to include diagnostic information
