# Phase 65b — Harden timeout sanitation edge cases

## Focus
Prevent edge cases where fractional `timeoutMs` values (e.g., `0.5`) could be coerced into `timeout: 0`, which may effectively “instant timeout”. The goal is to only include `timeout` in `requestOptions` when the **sanitized integer** value is a valid positive integer.

## Inputs
- `docs/planning/phase-65/a/plan.md` (initial timeout gating approach)
- `lib/ai/prompt-runner/runner.ts`:
  - `runStructuredJsonPrompt()` requestOptions block
  - `runTextPrompt()` requestOptions block
- OpenAI SDK validation behavior:
  - `node_modules/openai/src/client.ts` validates `timeout` when the key exists (`'timeout' in options`)

## Work
1. In both requestOptions blocks, compute a sanitized integer first, then conditionally include `timeout` based on the sanitized value (not the raw float).
2. Avoid the pattern `params.timeoutMs > 0 ? { timeout: Math.trunc(params.timeoutMs) } : {}` because `timeoutMs = 0.5` passes the gate but truncs to `0`.
3. Keep the change localized and minimal (no signature changes; no changes to `lib/ai/openai-telemetry.ts`).

### Suggested pattern (apply in both locations)

```ts
const timeout =
  typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs) ? Math.trunc(params.timeoutMs) : null;
const maxRetries =
  typeof params.maxRetries === "number" && Number.isFinite(params.maxRetries) ? Math.max(0, Math.trunc(params.maxRetries)) : null;

requestOptions: {
  ...(typeof timeout === "number" && timeout > 0 ? { timeout } : {}),
  ...(typeof maxRetries === "number" ? { maxRetries } : {}),
},
```

## Validation (RED TEAM)
- `rg -n "timeout: params\\.timeoutMs" lib/ai/prompt-runner/runner.ts` returns **0 matches**
- `npm run lint` passes
- `npm run build` passes

## Output

**Completed 2026-01-28**

- **File modified:** `lib/ai/prompt-runner/runner.ts`
- **Changes:**
  - Both `runStructuredJsonPrompt()` and `runTextPrompt()` now compute sanitized values FIRST, then gate on the sanitized integer
  - Pattern uses IIFE to compute `timeout` and `maxRetries` as local variables before spreading into requestOptions
- **Verification:**
  - `grep "timeout: params\\.timeoutMs"`: 0 matches (expected - no direct pass-through)
  - `npm run lint`: ✅ 0 errors
  - `npm run build`: ✅ Success

**Final pattern (both locations):**
```typescript
requestOptions: (() => {
  const timeout =
    typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs) ? Math.trunc(params.timeoutMs) : null;
  const maxRetries =
    typeof params.maxRetries === "number" && Number.isFinite(params.maxRetries) ? Math.max(0, Math.trunc(params.maxRetries)) : null;
  return {
    ...(typeof timeout === "number" && timeout > 0 ? { timeout } : {}),
    ...(typeof maxRetries === "number" ? { maxRetries } : {}),
  };
})(),
```

**Edge case coverage:**
- `timeoutMs = undefined` → `timeout = null` → key omitted → falls back to default (90s)
- `timeoutMs = NaN` → `timeout = null` → key omitted
- `timeoutMs = 0.5` → `timeout = 0` → `0 > 0` is FALSE → key omitted (prevents instant timeout)
- `timeoutMs = -100` → `timeout = -100` → `-100 > 0` is FALSE → key omitted
- `timeoutMs = 5000` → `timeout = 5000` → `5000 > 0` is TRUE → `{ timeout: 5000 }` included

## Handoff
Phase 65 complete. Deploy and verify via post-deploy SQL query in root plan.md.
