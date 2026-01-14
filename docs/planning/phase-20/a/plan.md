# Phase 20a — AI Draft Token/Time Budget + Retry Strategy

## Focus
Fix AI draft generation failures caused by output token limits and long-running LLM calls by tripling the token budget, enforcing strict timeouts, and retrying intelligently without blocking webhook completion.

## Inputs
- Vercel logs showing: `Failed to generate draft content (incomplete=max_output_tokens output_types=reasoning)` and intermittent OpenAI 500s.
- Draft generation code path (`lib/ai-drafts.ts`) and webhook callers.

## Work
1. Triple output-token budgets for draft generation and add an explicit retry when `incomplete=max_output_tokens`.
2. Add env knobs for draft token budget multiplier and output cap.
3. Add env knob to disable the extra input-token-count request for latency-sensitive contexts.
4. Wire webhook callers to pass a smaller timeout budget for draft generation.

## Output
- Increased draft output-token budgets by default (3x) and added a targeted retry when `response.incomplete_details.reason === "max_output_tokens"`:
  - `lib/ai-drafts.ts`
  - New env knobs:
    - `OPENAI_DRAFT_TOKEN_BUDGET_MULTIPLIER` (default `3`)
    - `OPENAI_DRAFT_MAX_OUTPUT_TOKENS_CAP` (default `8000`)
    - `OPENAI_DRAFT_PREFER_API_TOKEN_COUNT` (default `false`, avoids extra token-count request)
- Webhook draft generation is now timeboxed via `OPENAI_DRAFT_WEBHOOK_TIMEOUT_MS` (default `20000` ms):
  - `app/api/webhooks/ghl/sms/route.ts`
  - `app/api/webhooks/email/route.ts`
  - `app/api/webhooks/linkedin/route.ts`

## Handoff
Proceed to Phase 20b to make availability refresh resilient by caching resolved provider IDs and adding fallbacks using workspace auto-booking settings.
