# Phase 119c — Durability Improvements (Retry Budget Semantics + Insights Fallback)

## Focus
If Phase 119b shows residual truncation/guardrail rates above thresholds, implement durability improvements so the system recovers automatically instead of repeatedly erroring.

## Inputs
- Phase 119b monitoring results (feature error rates + sample error messages).
- Existing prompt-runner retry behavior (`lib/ai/prompt-runner/runner.ts`) and token budgeting utilities.

## Work
0. **Prerequisite: Trace lite-fallback consumers (GAP-6)**
   - Before implementing the lite extraction fallback, enumerate all read-sites for thread-extract output:
     - DB writes (which columns/JSON fields are populated from extraction results?)
     - UI components that render extraction data (insights panels, summary views)
     - Cron summary endpoints (`/api/cron/insights/*`) that consume extraction output
   - For each consumer, determine: does it handle missing/null fields gracefully, or will it crash?
   - Document the minimum viable "lite" schema shape explicitly — which fields can be null/omitted and which are required for DB/UI integrity.
   - **This step gates step 2** — do not build the fallback until consumer compatibility is confirmed.
1. Implement real `retryExtraTokens` semantics in the prompt runner
   - Today, `budget.retryExtraTokens` is configured by callers but not guaranteed to affect attempt expansion meaningfully. The runner uses `expandAttemptsWithMultiplier()` exclusively.
   - Implement:
     - For attempt N>1, expand `max_output_tokens` by both:
       - multiplier growth, and
       - a fixed additive `retryExtraTokens` (bounded by `retryMax`).
   - Also clean up `retryMinBaseTokens` in `lib/ai/prompt-runner/types.ts` — it is defined but never consumed. Either remove it or add a code comment explaining its intended future use.
   - Add unit tests proving attempt expansion respects:
     - `budget.max`
     - `budget.retryMax`
     - `budget.retryExtraTokens`
     - `OPENAI_PROMPT_MAX_ATTEMPTS`
   - **RED TEAM note:** With `OPENAI_PROMPT_MAX_ATTEMPTS=2` (default) and multiplier 1.2, attempt 2 gets only 3840 tokens (1.2 × 3200) — well below `retryMax: 6400`. If monitoring shows attempt-2 exhaustion, consider bumping default to 3 or documenting the env var override in 119d.
   - Status: **Implemented** via `lib/ai/prompt-runner/attempts.ts` + runner wiring, with unit tests in `lib/__tests__/prompt-runner-attempt-expansion.test.ts`.
2. Add an Insights Thread Extract fallback ("lite" extraction)
   - Trigger condition:
     - Full extraction fails due to `incomplete=max_output_tokens` after retries.
   - Fallback behavior:
     - Re-run extraction using a smaller schema and stricter output constraints:
       - cap item counts lower
       - add `maxLength` to all string fields
       - reduce/omit follow-up fields if no follow-up exists (but still return valid shape expected by DB/UI)
     - **Specify the concrete lite schema shape** (determined in step 0) — at minimum, list which fields become optional vs. required.
     - Store the lite result so the cron/job makes progress rather than failing repeatedly.
   - Add tests:
     - Fallback triggers only for truncation category.
     - Fallback returns schema-valid output shape.
     - Consumers (from step 0 trace) receive lite output without errors.
3. Tighten JSON schema constraints to prevent runaway verbosity
   - For the structured JSON schema passed to OpenAI:
     - Add `maxLength` for `summary` and list item strings.
     - Reduce `maxItems` where safe.
   - This is a primary lever to prevent budget blowups with strict schemas.
4. Consider `chat-answer.ts` budget hardening (GAP-4)
   - `lib/insights-chat/chat-answer.ts` has no `retryMax` or `retryExtraTokens` in its budget config.
   - If 119b monitoring shows chat-answer truncations, add these fields here too.
   - If no chat-answer truncations observed, defer and document as a known gap.
5. Re-run quality gates and redeploy
   - `npm test`
   - `npm run lint`
   - `npm run build`
   - Deploy and re-check Phase 119b thresholds.

## Output


## Handoff

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented additive `retryExtraTokens` expansion used by both structured-json and text prompts.
  - Added deterministic unit tests to prevent regression.
- Commands run:
  - `npm test` — pass
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass
- Blockers:
  - Lite extraction fallback work is gated on 119b monitoring + consumer tracing (not started).
- Next concrete steps:
  - If `insights.thread_extract` truncations persist after deploy: implement steps 0 and 2–4 (consumer trace + lite fallback + schema tightening).
