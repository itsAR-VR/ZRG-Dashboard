# Phase 119d — Docs + Runbook Updates

## Focus
Make the Phase 119 changes operable: document the new knobs, what they do, and how to verify/rollback safely.

## Inputs
- Phase 119a–c code changes and the production verification notes from Phase 119b.
- Existing repo conventions in `CLAUDE.md` (quality gates, cron auth checks). **Note:** the canonical conventions file is `CLAUDE.md`, not `AGENTS.md` (GAP-5 fix).

## Work
1. Document new environment knobs (no secrets)
   - Prompt retry backoff:
     - `OPENAI_PROMPT_RETRY_DELAY_MS` (default: 0)
     - `OPENAI_PROMPT_RETRY_DELAY_MULTIPLIER` (default: 2)
   - Prompt retry budget:
     - `OPENAI_PROMPT_MAX_ATTEMPTS` (default: 2)
     - `OPENAI_RETRY_OUTPUT_TOKENS_MULTIPLIER` (default: 1.2)
   - Step 3 rewrite-guardrail tuning:
     - `OPENAI_EMAIL_STEP3_REWRITE_RATIO` (default: 0.45)
     - `OPENAI_EMAIL_STEP3_REWRITE_MIN_DELTA` (default: 250)
     - `OPENAI_EMAIL_STEP3_REWRITE_MAX_DELTA` (default: 900)
     - `OPENAI_EMAIL_STEP3_REWRITE_LINE_RATIO` (default: 0.5)
     - `OPENAI_EMAIL_STEP3_REWRITE_MIN_LINE_DELTA` (default: 3)
   - Insights extraction/chat tuning:
     - `OPENAI_INSIGHTS_MAX_RETRIES` (default: 5, range: 0–10)
     - `OPENAI_INSIGHTS_THREAD_CHUNK_CONCURRENCY` (default: 3, range: 1–6)
     - `OPENAI_INSIGHTS_THREAD_TIMEOUT_MS` (default: 90000)
     - `OPENAI_INSIGHTS_ANSWER_TIMEOUT_MS` (default: 90000)
2. Add a short operator note: interpreting the two error classes
   - `Post-process error: hit max_output_tokens (…output_types=reasoning…)`
   - `email_step3_rewrite_guardrail`
3. Record final verification results
   - AI Dashboard snapshot notes:
     - error rate deltas for `insights.thread_extract`
     - guardrail trigger rate for Step 3
   - Cron smoke results for insights endpoints.
4. Optional (only if it materially helps ops): add a known-error signature entry
   - If logs include stable new markers (e.g. `email_step3_changed_flag_mismatch`), consider adding to `scripts/logs/assert-known-errors.ts`.

## Output


## Handoff

## Progress This Turn (Terminus Maximus)
- Work done:
  - Documented Phase 119 AI env knobs + error signatures in `CLAUDE.md`.
- Commands run:
  - (None specific to docs)
- Blockers:
  - Final verification evidence (AI Dashboard + cron smoke checks) requires a production deploy (blocked in this sandbox).
- Next concrete steps:
  - After deploying from a networked environment, record verification evidence here and then fill Output/Handoff.
