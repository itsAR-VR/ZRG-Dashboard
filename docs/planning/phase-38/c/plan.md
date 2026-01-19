# Phase 38c — Enhanced Telemetry for JSON Parse Failures

## Focus
Improve error telemetry to capture raw response text when JSON parsing fails, enabling better debugging of truncation and malformed output issues.

## Inputs
- Modified `parseStrategyJson` from 38a (returns `rawText` on failure)
- Retry loop from 38b (tracks attempt count and failure reasons)
- `lib/ai/openai-telemetry.ts` — `markAiInteractionError` function
- `AIInteraction` table schema

## Work

### 1. Enhance `markAiInteractionError` to accept raw response text

**Current signature**:
```typescript
export async function markAiInteractionError(
  interactionId: string,
  errorMessage: string
): Promise<void>
```

**Target signature**:
```typescript
export async function markAiInteractionError(
  interactionId: string,
  errorMessage: string,
  context?: {
    rawResponseText?: string;
    attempt?: number;
    maxAttempts?: number;
  }
): Promise<void>
```

### 2. Update error recording to include truncated raw text

In the `AIInteraction` update, include the raw text (truncated to ~500 chars) in the error message or a dedicated field:

```typescript
await prisma.aIInteraction.update({
  where: { id: interactionId },
  data: {
    errorMessage: context?.rawResponseText
      ? `${errorMessage} | raw_sample: ${context.rawResponseText.slice(0, 500)}`
      : errorMessage,
    // If there's a dedicated field for raw output, use it:
    // rawOutputSample: context?.rawResponseText?.slice(0, 1000),
  },
});
```

### 3. Add structured logging for parse failures

In `lib/ai-drafts.ts`, update the error handling to include:

```typescript
if (parseResult.status !== "complete") {
  console.warn("[AI Drafts] Strategy parse failure:", {
    leadId,
    attempt,
    status: parseResult.status,
    rawSample: parseResult.rawText?.slice(0, 200),
    interactionId: strategyInteractionId,
  });
}
```

### 4. Update error messages to be more descriptive

Instead of generic `strategy_parse_failed`:
- `strategy_truncated`: JSON was incomplete (braces didn't balance)
- `strategy_invalid`: JSON parsed but failed validation
- `strategy_empty`: No JSON object found in response
- `strategy_timeout`: Request timed out before response

### 5. Add monitoring guidance

Document how to query for these errors:
```sql
-- Find recent strategy parse failures
SELECT id, featureId, promptKey, errorMessage, createdAt
FROM "AIInteraction"
WHERE featureId = 'draft.generate.email.strategy'
  AND errorMessage IS NOT NULL
ORDER BY createdAt DESC
LIMIT 20;
```

## Output
**Completed 2026-01-19**

- Kept `markAiInteractionError(interactionId, errorMessage)` signature as-is, but now passes a high-signal categorized error message on final strategy parse failure.
- Error message includes: kind (`strategy_truncated` / `strategy_empty` / `strategy_invalid`), parse status, attempt counts, `max_output_tokens`, `summarizeResponseForTelemetry(...)`, and a capped raw sample (≤ 500 chars).
- Added structured Vercel-visible logs:
  - `console.warn` on intermediate parse failures (with attempt/status)
  - `console.error` when strategy retries are exhausted and we fall back to single-step

## Handoff
Phase 38 complete. Validation:
1. Run `npm run lint` — verify no new errors
2. Run `npm run build` — verify compilation succeeds
3. Test by triggering email draft generation with a lead that has conversation history
4. Monitor AIInteraction table for new error patterns
