# Phase 65a — Fix timeout validation in runner.ts

## Focus
Update `lib/ai/prompt-runner/runner.ts` to only include `timeout` in `requestOptions` when it's a valid positive integer. This prevents `undefined` from overwriting the default timeout in `openai-telemetry.ts`.

## Inputs
- Root cause analysis from Phase 65 plan
- Current state of `lib/ai/prompt-runner/runner.ts` (includes Phase 63 changes)
- Pattern reference: existing `maxRetries` validation in the same file

## Work

### Location 1: `runStructuredJsonPrompt()` (lines ~136-139)

**Current code:**
```typescript
requestOptions: {
  timeout: params.timeoutMs,
  maxRetries: typeof params.maxRetries === "number" ? params.maxRetries : undefined,
},
```

**Fixed code:**
```typescript
requestOptions: {
  ...(typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs) && params.timeoutMs > 0
    ? { timeout: Math.trunc(params.timeoutMs) }
    : {}),
  ...(typeof params.maxRetries === "number" && Number.isFinite(params.maxRetries)
    ? { maxRetries: Math.max(0, Math.trunc(params.maxRetries)) }
    : {}),
},
```

### Location 2: `runTextPrompt()` (lines ~344-347)

**Current code:**
```typescript
requestOptions: {
  timeout: params.timeoutMs,
  maxRetries: typeof params.maxRetries === "number" ? params.maxRetries : undefined,
},
```

**Fixed code:**
```typescript
requestOptions: {
  ...(typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs) && params.timeoutMs > 0
    ? { timeout: Math.trunc(params.timeoutMs) }
    : {}),
  ...(typeof params.maxRetries === "number" && Number.isFinite(params.maxRetries)
    ? { maxRetries: Math.max(0, Math.trunc(params.maxRetries)) }
    : {}),
},
```

### Validation Logic Explanation

The fix ensures:
- `undefined` → not included in object, falls back to default in `openai-telemetry.ts`
- `NaN` → filtered by `Number.isFinite()`, not included
- Negative values → filtered by `> 0` check, not included
- Floats like `3000.5` → truncated to integer `3000`
- Valid positive integers → passed through as-is

### Verification Steps

1. Run `npm run lint` — must pass
2. Run `npm run build` — must pass
3. Deploy to preview and monitor AI telemetry for "timeout must be an integer" errors

## Output

**Completed 2026-01-28**

- **File modified:** `lib/ai/prompt-runner/runner.ts`
- **Changes:**
  - `runStructuredJsonPrompt()` (lines 136-143): Fixed timeout validation to use conditional spread
  - `runTextPrompt()` (lines 348-355): Same fix applied
- **Verification:**
  - `npm run lint`: ✅ 0 errors (18 pre-existing warnings)
  - `npm run build`: ✅ Success

**Before/After:**
```typescript
// Before - passes timeout: undefined which triggers OpenAI SDK validation error
requestOptions: {
  timeout: params.timeoutMs,
  maxRetries: typeof params.maxRetries === "number" ? params.maxRetries : undefined,
},

// After - omits timeout key entirely when invalid, allowing telemetry defaults to apply
requestOptions: {
  ...(typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs) && params.timeoutMs > 0
    ? { timeout: Math.trunc(params.timeoutMs) }
    : {}),
  ...(typeof params.maxRetries === "number" && Number.isFinite(params.maxRetries)
    ? { maxRetries: Math.max(0, Math.trunc(params.maxRetries)) }
    : {}),
},
```

## Handoff
Phase 65a complete. Proceed to Phase 65b for edge case hardening if needed, or mark phase complete and deploy.
