# Phase 77d — Hardening: Prompt-Runner Retry Semantics + Timeout/Cost Guardrails

## Focus

Ensure Phase 77’s fixes map correctly onto the actual prompt-runner semantics so we don’t “ship a fix” that fails to increase `max_output_tokens` (or fails to retry) for reasoning models.

## Inputs

- `lib/ai/prompt-runner/runner.ts`
  - `runTextPrompt(...)` uses:
    - `attempts: number[]` (explicit retry budgets)
    - `maxRetries` / `retryOn` (request-level retry categories)
    - `budget` to compute the initial adaptive `max_output_tokens`, and retries auto-increase `max_output_tokens` by +20% per attempt (global policy)
  - `runStructuredJsonPrompt(...)` uses `budget.retryMax` as a retry cap (and also auto-increases `max_output_tokens` by +20% per attempt).
- Files Phase 77 touches:
  - `lib/followup-engine.ts` (`parseAcceptedTimeFromMessage`, `detectMeetingAcceptedIntent`)
  - `lib/ai-drafts.ts` (Email Draft Strategy tokens; Step 3 verifier retries + timeout allocation)

## Work

### 1) Follow-up parsing: make retries real (text prompt)

**Goal:** eliminate `incomplete=max_output_tokens output_types=reasoning` errors for both functions.

**Implementation note:** retries are handled centrally by the prompt runner:
- On retry, `max_output_tokens` increases by **20%** (global policy).
- If you provide `budget.retryMax`, it acts as a hard cap for the retry attempts.

Keep the output contract unchanged:
- `parseAcceptedTimeFromMessage`: slot number or `NONE`
- `detectMeetingAcceptedIntent`: `YES` / `NO`

### 2) Strategy budget change: verify env var overrides won’t negate the code change

If `OPENAI_EMAIL_STRATEGY_BASE_MAX_OUTPUT_TOKENS` is set in Vercel/env to `"2000"`, changing the default string in code will not affect production. Confirm which rollout is intended:
- code default only
- env var update
- both (recommended if you want deterministic prod behavior)

### 3) Verifier timeout + retry: fix the real bottleneck

If Step 3 timed out with a ~20s cap:

- Add a second attempt to the verifier call (`attempts: [1400, 2000]` or similar).
- If timeouts persist:
  - increase the Step 3 timeout cap at the call site (currently `Math.min(20_000, ...)`)
  - and/or clamp the largest template vars passed into the verifier prompt (knowledge context, booking-process instructions).

### 4) Guardrails

- Keep caps explicit (avoid unbounded token increases).
- Prefer a retry attempt over permanently raising first-attempt budgets when the error rate is low.

## Validation (RED TEAM)

- `npm run lint`
- `npm run build`
- Monitor the error dashboard for 24 hours:
  - signature extractor schema 400s should stop entirely
  - follow-up parsing should stop producing `max_output_tokens` incomplete responses
  - strategy/verifier should stop producing `max_output_tokens` and timeout errors

## Output

- Phase 77 implementation reflects prompt-runner semantics (real retries + real token increases where needed) with cost/latency guardrails.

## Handoff

Phase 77 complete; if any error signature persists, capture the exact promptKey + error category and tune only that prompt's tokens/timeouts.

## Review Notes

- **Status:** Deferred — hardening work not implemented in this phase
- **Rationale:** Core fixes (77a, 77b, 77c) address the immediate error patterns. Hardening is optional follow-up work if errors persist after monitoring.
- **Follow-up:** Monitor error dashboard for 24 hours; revisit if needed
