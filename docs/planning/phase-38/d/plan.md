# Phase 38d — Hardening (Timeout Budget, Schema Size, Safe Telemetry)

## Focus
Reduce residual strategy-step failures by (1) enforcing an overall timeout budget across retries, (2) constraining Structured Output size to prevent truncation, and (3) making telemetry/debug signals high-signal while minimizing sensitive data exposure.

## Inputs
- `lib/ai-drafts.ts`
  - Step 1 (Strategy) in `generateResponseDraft(...)`
  - `EMAIL_DRAFT_STRATEGY_JSON_SCHEMA`
  - `parseStrategyJson(...)`
- `lib/ai/response-utils.ts`
  - `extractFirstCompleteJsonObjectFromText(...)`
  - `summarizeResponseForTelemetry(...)`
- `lib/ai/openai-telemetry.ts`
  - `runResponseWithInteraction(...)`
  - `markAiInteractionError(...)`
- `prisma/schema.prisma`
  - `AIInteraction` fields (notably `errorMessage`, token counts, and timestamps)

## Work

### 1) Timebox the strategy retries (no runaway latency)
- Track a `strategyStartMs` before attempt 1.
- Before each attempt:
  - compute `remainingMs = strategyTimeoutMs - (Date.now() - strategyStartMs)`
  - if `remainingMs` is too small for another OpenAI call (e.g., < 2–5s), stop retrying
  - set `requestOptions.timeout = clamp(remainingMs, minAttemptTimeoutMs, maxAttemptTimeoutMs)`
- Ensure total wall-clock time across attempts stays within `timeoutMs` (and therefore doesn’t jeopardize Step 2 generation).

### 2) Distinguish attempts in telemetry
- Update the strategy `promptKey` per attempt:
  - attempt 1: `draft.generate.email.strategy.v1.arch_<id>`
  - attempt 2+: `draft.generate.email.strategy.v1.arch_<id>.retry2` (etc)
- Include attempt count in the post-process error message/context (only on final failure to avoid telemetry spam).

### 3) Constrain the Structured Output schema to reduce truncation risk
- Add size constraints to `EMAIL_DRAFT_STRATEGY_JSON_SCHEMA` where supported:
  - `personalization_points`: `minItems: 0`, `maxItems: 4`, item `maxLength`
  - `outline`: `minItems: 0`, `maxItems: 5`, item `maxLength`
  - `must_avoid`: `minItems: 0`, `maxItems: 6`, item `maxLength`
  - `intent_summary`: `maxLength`
  - `times_to_offer`: `maxItems` (when array), item `maxLength`
- Keep constraints conservative so the model still has room to be useful, but cannot bloat the output beyond `max_output_tokens`.

### 4) Make telemetry debuggable but data-minimized
- Prefer including:
  - parse status (`none` / `incomplete` / `invalid`)
  - attempt/maxAttempts
  - a compact `summarizeResponseForTelemetry(strategyResponse)` string
- If storing a raw sample, cap aggressively and avoid transcripts:
  - store only a short sample of `response.output_text` (e.g., first 300–800 chars)
  - strip newlines and/or truncate to a single line to keep `errorMessage` readable

### 5) Fix SQL query examples to match Postgres identifier casing
- Use quoted identifiers for camelCase columns unless the DB schema maps them:
  - `SELECT "id", "featureId", "promptKey", "errorMessage", "createdAt" FROM "AIInteraction" ...`

## Validation (RED TEAM)
- Generate an email draft for a lead with a long transcript; verify:
  - retries do not exceed `timeoutMs`
  - attempt-level `promptKey` values appear as expected
  - strategy parsing succeeds or records a high-signal error message including parse status + attempt counts
- Inspect `AIInteraction` rows for `featureId='draft.generate.email.strategy'`:
  - confirm `outputTokens` near the configured `max_output_tokens` when truncation occurs (supports hypothesis)
  - confirm error messages remain capped and readable
- Run `npm run lint` and `npm run build`.

## Output
**Completed 2026-01-19**

- Timeboxed strategy retries to the existing strategy timeout budget (no runaway latency).
- Added JSON-schema size constraints to `EMAIL_DRAFT_STRATEGY_JSON_SCHEMA` (`maxItems` / `maxLength`) to reduce truncation risk.
- Ensured parse-failure telemetry is debuggable but capped (single-line sample ≤ 500 chars + `summarizeResponseForTelemetry`).
- Added additional reliability hardening so `generateResponseDraft` will always produce a draft (falls back to deterministic safe content if OpenAI returns nothing after retries).

## Handoff
Return to Phase 38 overall validation and monitoring:
1. Trigger several email draft generations (short + long transcripts)
2. Verify strategy parse failures are reduced and now diagnosable
3. Revisit Open Questions if failures persist (fallback vs schema change)
