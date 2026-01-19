# Phase 38a — Apply Truncation-Aware Parsing to Email Draft Strategy

## Focus
Replace the simple `JSON.parse()` in `parseStrategyJson()` with `extractFirstCompleteJsonObjectFromText()` to detect truncated JSON before attempting to parse.

## Inputs
- `lib/ai-drafts.ts` — current `parseStrategyJson` function (lines 556-574)
- `lib/ai/response-utils.ts` — `extractFirstCompleteJsonObjectFromText()` utility
- Pattern from `lib/lead-scoring.ts` (commit 15ace5c) showing correct usage

## Work

### 1. Update `parseStrategyJson` function

**Current implementation** (lines 556-574):
```typescript
function parseStrategyJson(text: string | null | undefined): EmailDraftStrategy | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    // Validate required fields exist
    if (
      Array.isArray(parsed.personalization_points) &&
      typeof parsed.intent_summary === "string" &&
      typeof parsed.should_offer_times === "boolean" &&
      Array.isArray(parsed.outline) &&
      Array.isArray(parsed.must_avoid)
    ) {
      return parsed as EmailDraftStrategy;
    }
    return null;
  } catch {
    return null;
  }
}
```

**Target implementation**:
```typescript
function parseStrategyJson(text: string | null | undefined): {
  strategy: EmailDraftStrategy | null;
  status: "complete" | "incomplete" | "none" | "invalid";
  rawText?: string;
} {
  if (!text) return { strategy: null, status: "none" };

  const extracted = extractFirstCompleteJsonObjectFromText(text);

  if (extracted.status === "incomplete") {
    return { strategy: null, status: "incomplete", rawText: text.slice(0, 500) };
  }

  if (extracted.status === "none" || !extracted.json) {
    return { strategy: null, status: "none", rawText: text.slice(0, 500) };
  }

  try {
    const parsed = JSON.parse(extracted.json);
    // Validate required fields exist
    if (
      Array.isArray(parsed.personalization_points) &&
      typeof parsed.intent_summary === "string" &&
      typeof parsed.should_offer_times === "boolean" &&
      Array.isArray(parsed.outline) &&
      Array.isArray(parsed.must_avoid)
    ) {
      return { strategy: parsed as EmailDraftStrategy, status: "complete" };
    }
    return { strategy: null, status: "invalid", rawText: extracted.json.slice(0, 500) };
  } catch {
    return { strategy: null, status: "invalid", rawText: extracted.json?.slice(0, 500) };
  }
}
```

### 2. Update import statement

Add `extractFirstCompleteJsonObjectFromText` to the imports from `@/lib/ai/response-utils`.

### 3. Update caller site (around line 929)

The caller currently does:
```typescript
const strategyText = getTrimmedOutputText(strategyResponse)?.trim();
strategy = parseStrategyJson(strategyText);

if (!strategy && strategyInteractionId) {
  await markAiInteractionError(strategyInteractionId, "strategy_parse_failed: Could not parse strategy JSON");
}
```

This needs to be updated to handle the new return type and status.

## Output
**Completed 2026-01-19**

- Updated `parseStrategyJson` in `lib/ai-drafts.ts` to use `extractFirstCompleteJsonObjectFromText` and return a structured `{ status, strategy?, rawSample? }` result.
- Added stricter runtime validation for required fields (including `times_to_offer` array-or-null + item types) before accepting the strategy.
- Updated `lib/ai-drafts.ts` imports to include `extractFirstCompleteJsonObjectFromText`.

## Handoff
Subphase 38b will:
1. Add retry loop for `incomplete` status (increase tokens on retry)
2. Add logging for truncation detection
