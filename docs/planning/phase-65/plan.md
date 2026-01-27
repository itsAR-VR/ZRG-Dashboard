# Phase 65 — Fix "timeout must be an integer" AI Call Errors

## Purpose
Fix the "timeout must be an integer" validation error causing ~2,500+ failed AI calls per day across Signature Extraction, Email Inbox Analyze, and Timezone Inference prompts.

## Context
**Error Signature (2026-01-27):**
```
Signature Extraction (gpt-5-nano): 1,210 errors - "timeout must be an integer"
Email Inbox Analyze (gpt-5-mini): 850 errors - "timeout must be an integer"
Timezone Inference (gpt-5-nano): 448 errors - "timeout must be an integer"
```

**Root Cause Analysis:**

The error originates from a timeout value propagation bug in the prompt runner:

1. **Callers don't specify `timeoutMs`**: Functions like `extractContactFromSignature()` (signature-extractor.ts:57) and `ensureLeadTimezone()` (timezone-inference.ts:198) call `runStructuredJsonPrompt()` without a `timeoutMs` parameter.

2. **`runner.ts` passes `undefined` through**: At lines 136-139:
   ```typescript
   requestOptions: {
     timeout: params.timeoutMs,  // undefined when not specified
     maxRetries: ...
   }
   ```

3. **`openai-telemetry.ts` spread overwrites the default**: At lines 136-140:
   ```typescript
   const requestOptions: OpenAI.RequestOptions = {
     timeout: defaultTimeout,      // valid integer (90000)
     maxRetries: defaultMaxRetries,
     ...opts.requestOptions,       // { timeout: undefined } overwrites!
   };
   ```

4. **OpenAI SDK rejects `undefined`**: The SDK validates that `timeout` must be an integer, so `undefined` fails validation.

**JavaScript Gotcha**: When spreading `{ timeout: undefined }` over `{ timeout: 90000 }`, the explicit `undefined` replaces the default — this is standard JavaScript behavior but surprising in this context.

## Repo Reality Check (RED TEAM)

- What exists today:
  - `lib/ai/prompt-runner/runner.ts` passes `timeout: params.timeoutMs` in `requestOptions` for:
    - `runStructuredJsonPrompt()` (around lines ~136–139)
    - `runTextPrompt()` (around lines ~344–347)
  - `lib/ai/openai-telemetry.ts` builds request options via:
    - `{ timeout: defaultTimeout, maxRetries: defaultMaxRetries, ...opts.requestOptions }` (lines ~136–140)
  - OpenAI SDK validates `timeout` when the key exists:
    - `node_modules/openai/src/client.ts` checks `if ('timeout' in options) validatePositiveInteger('timeout', options.timeout);` (around line ~886), so `{ timeout: undefined }` throws `"timeout must be an integer"`.
  - OpenAI Node SDK docs confirm `timeout` is configured as a `number` in milliseconds (global client option or per-request override).
  - Call sites like:
    - `lib/signature-extractor.ts:57` (`extractContactFromSignature()`)
    - `lib/timezone-inference.ts:198` (`ensureLeadTimezone()`)
    call `runStructuredJsonPrompt()` without providing `timeoutMs`, so `params.timeoutMs` is `undefined`.
- What the plan assumes:
  - The safest minimal fix is to **omit** the `timeout` key unless a valid integer timeout is provided, letting `lib/ai/openai-telemetry.ts` defaults apply.
- Verified touch points:
  - `lib/ai/prompt-runner/runner.ts` — `runStructuredJsonPrompt`, `runTextPrompt`
  - `lib/ai/openai-telemetry.ts` — `runResponseWithInteraction`
  - `lib/signature-extractor.ts` — `extractContactFromSignature`
  - `lib/timezone-inference.ts` — `ensureLeadTimezone`

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Accidentally still setting the `timeout` key** (even to `undefined`) → ensure the fix uses conditional object spreads (no `"timeout" in options` unless intentional).
- **Float edge cases** (e.g., `timeoutMs = 0.5`) → avoid coercing sub-1 values into `timeout: 0` (can effectively “instant timeout”). Gate on the **sanitized integer** value, not the raw float.

### Missing or ambiguous requirements
- Define the intended semantics for:
  - `timeoutMs = 0` (should it be allowed or treated as invalid and fall back to default?)
  - fractional values (reject vs coerce vs sanitize-then-gate)
- “Errors no longer appear in production logs” is vague → add a concrete query against `AIInteraction` to verify the error rate is 0 post-deploy.

### Repo mismatches (fix the plan)
- The working tree may not actually have “Phase 63 uncommitted changes” at execution time → require a pre-flight `git status` check instead of asserting current state.

### Rollback / fallback
- If errors persist after deploy:
  - verify there are no remaining `timeout:` keys with non-integers in the codebase
  - revert the change and/or add a defense-in-depth strip-`undefined` step in `lib/ai/openai-telemetry.ts` (separate phase if needed)

## Decisions (Confirmed)

- Treat `timeoutMs <= 0` as invalid and omit the `timeout` key (falls back to `lib/ai/openai-telemetry.ts` default).
- For fractional `timeoutMs`, sanitize via `Math.trunc()` and only include `timeout` when the sanitized integer is `> 0` (Phase 65b).

## Concurrent / Related Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 63 | In progress (plan) | `lib/ai/prompt-runner/runner.ts`, `lib/ai/prompt-runner/types.ts` | Touches the same prompt runner paths; apply Phase 65 on top of the current `runner.ts` (rebase/merge as needed). |
| Phase 64 | In progress (untracked plan) | None found | No prompt-runner / telemetry overlap detected in plan docs. |
| Phase 22 | Historical | `lib/ai/openai-telemetry.ts` | Root cause depends on `openai-telemetry` requestOptions merging behavior; avoid changing that file in this phase. |
| Phase 57 | Historical | `lib/ai/prompt-runner/runner.ts` | Earlier prompt-runner work; unlikely to conflict, but reinforces that this file is a shared hot spot. |

## Pre-Flight Conflict Check (Multi-Agent)

- [ ] Run `git status --porcelain` and confirm no unexpected uncommitted changes to:
  - `lib/ai/prompt-runner/runner.ts`
  - `lib/ai/openai-telemetry.ts`
- **Files this phase will touch:**
  - `lib/ai/prompt-runner/runner.ts` — Fix timeout validation (2 locations)
- **Coordination requirement:** Phase 65 builds on top of the current prompt runner shape (Phase 63 overlap); rebase/merge if Phase 63 is still evolving.

## Objectives
* [x] Fix `runStructuredJsonPrompt()` to only include `timeout` in requestOptions when valid
* [x] Fix `runTextPrompt()` with the same validation pattern
* [ ] Verify fix eliminates "timeout must be an integer" errors (pending deploy)

## Constraints
- Minimal change: only modify the specific lines causing the issue
- Defensive validation pattern: match existing `maxRetries` validation style
- No behavior change for callers that already pass valid timeouts
- Backward compatible: missing `timeoutMs` falls back to `openai-telemetry.ts` default (90s)

## Non-Goals
- Retuning prompts/models/budgets (pure requestOptions hygiene)
- Refactoring `lib/ai/openai-telemetry.ts` requestOptions merging (keep the fix localized to the prompt runner)

## Success Criteria
- [x] `npm run lint` passes
- [x] `npm run build` passes
- [ ] "timeout must be an integer" errors no longer appear in production logs (verify post-deploy)
- [x] AI calls without explicit `timeoutMs` use the default 90s timeout

### Measurable Post-Deploy Check (recommended)

Run a quick DB check against `AIInteraction` to confirm the error is gone:

```sql
select
  "featureId",
  count(*) as errors
from "AIInteraction"
where "status" = 'error'
  and "createdAt" >= now() - interval '60 minutes'
  and "errorMessage" ilike '%timeout must be an integer%'
group by 1
order by 2 desc;
```

## Subphase Index
* a — Fix timeout validation in runner.ts ✅
* b — Harden timeout sanitation edge cases ✅

## Phase Summary

**Status:** ✅ Complete (pending deploy verification)

**Completed 2026-01-28**

### What Was Done
- **65a:** Applied defensive timeout validation using conditional spread pattern — omits `timeout` key when `params.timeoutMs` is undefined, NaN, or non-positive
- **65b:** Hardened edge case handling by computing sanitized integer FIRST, then gating on the sanitized value (prevents `0.5` → `timeout: 0` issue)

### Key Fix
Both `runStructuredJsonPrompt()` and `runTextPrompt()` in `lib/ai/prompt-runner/runner.ts` now use an IIFE pattern:

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

### Artifacts Modified
- `lib/ai/prompt-runner/runner.ts` (lines 136-146, 350-360)

### Verification
- `npm run lint`: ✅ pass (2026-01-28T02:00:53+04:00) — 0 errors, 18 warnings
- `npm run build`: ✅ pass (2026-01-28T02:08:59+04:00) — Next.js build succeeded (with workspace-root inference + middleware deprecation warnings)
- `grep "timeout: params\\.timeoutMs"`: 0 matches (no direct pass-through remains)

### Post-Deploy Verification
Run the SQL query in the "Measurable Post-Deploy Check" section above after deploying to confirm errors have stopped.
