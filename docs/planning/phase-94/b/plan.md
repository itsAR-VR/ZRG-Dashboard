# Phase 94b — Core Fixes (Timeout Caps + Token Budgets in AI Pipeline)

## Focus
Implement code changes that directly mitigate:
- Step 3 verifier timeouts (remove ~20s cliff).
- Signature context timeouts (remove ~4.5s cliff).
- Proposed-times parsing truncation (`max_output_tokens` incomplete).
- Lead scoring transient 500s (reduce noise, improve success rate).

## Inputs
- Baseline report from Phase 94a.
- Current code (verified line numbers):
  - `lib/ai-drafts.ts:2381` — Step 3 verifier timeout
  - `lib/ai-drafts.ts:1498` — Signature context timeout
  - `lib/email-signature-context.ts` — Default timeout fallback
  - `lib/followup-engine.ts:2317-2414` — `parseProposedTimesFromMessage`
  - `lib/followup-engine.ts:2401-2408` — Current budget `{min:256, max:800, retryMax:1400}`
  - `lib/lead-scoring.ts:158-254` — `scoreLeadFromConversation`
  - `lib/lead-scoring.ts:247` — `maxRetries: 0` (disables SDK retries)
  - `lib/ai/prompt-runner/runner.ts:20` — `OPENAI_PROMPT_MAX_ATTEMPTS` (default 2)

## Work
### 1) Make Step 3 verifier timeout configurable + higher by default
**File:** `lib/ai-drafts.ts` (email channel, Step 3 verifier call)

Replace the hard cap:
- Current: `timeoutMs: Math.min(20_000, Math.max(3_000, Math.floor(timeoutMs * 0.25)))`

With a cap/min/share model (env-configurable), computed once per draft:
- Env vars (defaults):
  - `OPENAI_EMAIL_VERIFIER_TIMEOUT_MS_CAP=45000`
  - `OPENAI_EMAIL_VERIFIER_TIMEOUT_MS_MIN=8000`
  - `OPENAI_EMAIL_VERIFIER_TIMEOUT_SHARE=0.35`
- Computation:
  - `shareMs = floor(totalTimeoutMs * share)`
  - `verifierTimeoutMs = min(cap, max(min, shareMs))`
- Safety clamps:
  - Clamp `share` to `[0.05, 0.8]`
  - Ensure `min <= cap` (if misconfigured, coerce `cap = min` or expand cap)

Pass `verifierTimeoutMs` to `runEmailDraftVerificationStep3({ timeoutMs: verifierTimeoutMs, ... })`.

### 2) Make signature context timeout configurable + higher by default
**File:** `lib/ai-drafts.ts` (signature context extraction for trigger message)

Replace the hard cap:
- Current: `timeoutMs: Math.min(4500, Math.max(1000, Math.floor(timeoutMs * 0.15)))`

With env-configurable cap/min/share:
- Env vars (defaults):
  - `OPENAI_SIGNATURE_CONTEXT_TIMEOUT_MS_CAP=10000`
  - `OPENAI_SIGNATURE_CONTEXT_TIMEOUT_MS_MIN=3000`
  - `OPENAI_SIGNATURE_CONTEXT_TIMEOUT_SHARE=0.2`
- Computation and clamps same style as Step 3 verifier.

### 3) Raise signature context default timeout to match new expectations
**File:** `lib/email-signature-context.ts`

Today, when `opts.timeoutMs` is not provided, the function uses ~4500ms.
Update fallback default to ~10,000ms so any future callers (or refactors) don’t inherit a too-low default.

Implementation detail:
- Keep honoring explicit `opts.timeoutMs`.
- If missing, use `OPENAI_SIGNATURE_CONTEXT_TIMEOUT_MS_CAP` (or a hardcoded 10s fallback) for the timeout default.

### 4) Fix `followup.parse_proposed_times` `max_output_tokens` truncation
**File:** `lib/followup-engine.ts` → `parseProposedTimesFromMessage(...)` (line 2317)

Goal: ensure retries can actually reach a sufficiently large `max_output_tokens` when reasoning tokens consume the output budget.

**Current state (verified):**
```typescript
budget: {
  min: 256,
  max: 800,
  retryMax: 1400,
  overheadTokens: 192,
  outputScale: 0.15,
  preferApiCount: true,
},
```

**Changes:**
- Remove explicit `attempts` array (let runner compute from budget)
- Add `maxAttempts: 4` to allow sufficient retries
- Increase budget:
  - `budget.min: 512`
  - `budget.max: 1200`
  - `budget.retryMax: 2400`
- Change `reasoningEffort` from `"low"` → `"minimal"` for this extractor-style task (reduces reasoning-token burn)

### 5) Reduce Lead Scoring 500-noise via request-level retries (not multi-attempt loops)
**File:** `lib/lead-scoring.ts` → `scoreLeadFromConversation(...)`

Current behavior:
- Uses prompt-runner multi-attempt patterns and sets `maxRetries: 0` (disables SDK retries).

Target behavior:
- Prefer SDK request retries for transient 500s (fewer error rows, better success probability).

Implementation:
- Set prompt-runner attempts to a single attempt (no manual multi-attempt loop):
  - `attempts: [baseBudget.maxOutputTokens]`
  - `maxAttempts: 1`
- Enable OpenAI SDK request retries for this call:
  - `maxRetries: Number.parseInt(process.env.OPENAI_LEAD_SCORING_MAX_RETRIES || "2", 10) || 2`
- Keep timeout reasonable:
  - Keep existing `OPENAI_LEAD_SCORING_TIMEOUT_MS` default of 20s unless Phase 94a shows timeouts.

### 6) Local validation
- `npm run lint`
- `npm run build`

## Output
- Implemented configurable, proportional timeout "slices" in `lib/ai-drafts.ts`:
  - Step 3 email verifier now uses `OPENAI_EMAIL_VERIFIER_TIMEOUT_*` cap/min/share (defaults: 45s / 8s / 0.35).
  - Signature context extraction now uses `OPENAI_SIGNATURE_CONTEXT_TIMEOUT_*` cap/min/share (defaults: 10s / 3s / 0.2).
  - Both slices clamp to the overall `timeoutMs` so webhook contexts stay bounded.
- Raised signature context default timeout in `lib/email-signature-context.ts` to ~10s (or env cap) when callers omit `opts.timeoutMs`.
- Fixed `followup.parse_proposed_times` truncation risk by:
  - Setting `reasoningEffort: "minimal"`, `maxAttempts: 4`
  - Increasing budget to `{ min: 512, max: 1200, retryMax: 2400 }`
- Reduced Lead Scoring 5xx noise by switching to SDK request retries (single prompt-runner attempt):
  - `attempts: [baseBudget.maxOutputTokens]`, `maxAttempts: 1`
  - `maxRetries` now comes from `OPENAI_LEAD_SCORING_MAX_RETRIES` (default 2) or `opts.maxRetries`
- Lint/build: deferred to Phase 94e.

## Handoff
Proceed to **Phase 94c** to prevent overlapping cron invocations from compounding timeouts under load.
