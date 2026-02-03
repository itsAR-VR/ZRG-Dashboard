# Phase 94a — Baseline Diagnostics (AIInteraction + Vercel Logs + Call-Site Audit)

## Focus
Lock in a baseline and confirm the exact runtime cliffs causing the observed errors (timeouts at ~20s / ~4.5s, and `max_output_tokens` truncation) before changing any code or env vars.

## Inputs
- Root plan: `docs/planning/phase-94/plan.md`
- AI telemetry table: `prisma/schema.prisma` → `AIInteraction`
- OpenAI runner/telemetry:
  - `lib/ai/openai-telemetry.ts`
  - `lib/ai/prompt-runner/runner.ts`
- Known call sites:
  - `lib/ai-drafts.ts` (Step 3 verifier + signature context extraction)
  - `lib/email-signature-context.ts`
  - `lib/followup-engine.ts` (`parseProposedTimesFromMessage`)
  - `lib/lead-scoring.ts`
- Vercel cron config: `vercel.json`
- AGENTS doc: `AGENTS.md`

## Work
1) Baseline AIInteraction metrics (SQL)
   - Run these queries against the current prod DB (Supabase MCP or psql):
     - Step 3 verifier (`draft.verify.email.step3`): errors by source, avg/max latency, and latency percentiles.
     - Signature context (`signature.context`): errors by source, avg/max latency.
     - followup proposed times (`followup.parse_proposed_times`): latest error messages.
     - Lead scoring (`lead_scoring.score`): last 5 errors with request IDs.
   - Save the outputs (numbers + timestamps) into a short “baseline” note under `docs/planning/phase-94/` (do not include PII).

2) Vercel deployment + log baseline
   - Using Vercel CLI:
     - `vercel list --environment production --status READY --yes` to identify the current production deployment URL.
     - `vercel logs <deployment-url>` to stream recent logs (5-minute window).
   - Confirm:
     - `/api/cron/background-jobs` is executing on schedule.
     - Any obvious bursts/overlap signals (multiple invocations running concurrently).
     - Any OpenAI timeout logs/errors and which route/job emitted them (look at the log prefix, source attribution, or stack traces).

3) Call-site audit (timeouts and budgets)
   - In `lib/ai-drafts.ts`, identify and record:
     - The Step 3 verifier timeout formula and current cap (currently ~20s).
     - The signature context timeout formula and current cap (currently ~4.5s).
   - In `lib/followup-engine.ts`:
     - Confirm `parseProposedTimesFromMessage` budgets, retryMax, and whether the runner will ever reach retryMax given `OPENAI_PROMPT_MAX_ATTEMPTS`.
   - In `lib/lead-scoring.ts`:
     - Confirm the current retry behavior: prompt-runner attempts vs OpenAI SDK `maxRetries` (request-level).

4) Environment audit (no secrets in output)
   - Confirm what’s set in Vercel env (prod):
     - `OPENAI_TIMEOUT_MS`
     - `OPENAI_DRAFT_TIMEOUT_MS`
     - `OPENAI_DRAFT_WEBHOOK_TIMEOUT_MS`
     - `OPENAI_PROMPT_MAX_ATTEMPTS`
     - `OPENAI_MAX_RETRIES`
   - Record only the presence + numeric values (no keys/tokens).

## Output
- Baseline report written: `docs/planning/phase-94/baseline.md`
  - Includes AIInteraction counts + latency clusters proving:
    - Step 3 verifier failures cluster at ~20s (`Request timed out.`).
    - Signature context failures cluster at ~4.5s (`Request timed out.`).
    - `followup.parse_proposed_times` failures are `max_output_tokens` (reasoning tokens).
    - Lead scoring failures are upstream 500/503 errors (request IDs captured).
  - Confirms Vercel Production env has only `OPENAI_API_KEY` set under `OPENAI_*`; all timeout/retry behavior is from code defaults.
- Vercel baseline:
  - Current prod deployment URL identified via `vercel list`.
  - `vercel logs` confirms `/api/cron/background-jobs` and `/api/webhooks/email` are active (log lines may contain PII; none copied into the baseline doc).
- Exact code locations to change next:
  - `lib/ai-drafts.ts` — Step 3 verifier timeout cap (~20s) and signature context timeout cap (~4.5s).
  - `lib/email-signature-context.ts` — default timeout fallback (~4.5s).
  - `lib/followup-engine.ts` — `parseProposedTimesFromMessage` budgets/attempts.
  - `lib/lead-scoring.ts` — 500/503 retry strategy.
  - `app/api/cron/background-jobs/route.ts` — add advisory lock (Phase 94c).

## Coordination Notes
- Working tree has uncommitted changes from other phases (notably Phase 93) including `lib/followup-engine.ts`.
- Next subphase (94b) must re-read current file state before edits and merge semantically.

## Handoff
Proceed to **Phase 94b** with:
- Baseline metrics recorded
- Confirmed call sites and current timeout caps
- Verified current Vercel deployment URL and log access path
