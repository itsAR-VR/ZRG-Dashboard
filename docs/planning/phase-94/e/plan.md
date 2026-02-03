# Phase 94e — Verification + Rollout (Tests, Deploy, Monitor, Rollback)

## Focus
Prove the fixes work in production with measurable reductions in error rates, without introducing regressions.

## Inputs
- Phase 94b code changes merged.
- Phase 94c cron advisory lock merged.
- Phase 94d env vars set in Vercel.
- Baseline metrics from Phase 94a.

## Work
1) Local verification (pre-deploy)
   - `npm run lint`
   - `npm run build`
   - If any Prisma schema changes were pulled in from concurrent phases, run `npm run db:push` against the correct DB (only if schema changed as part of this phase).

2) Deploy
   - Deploy to Preview first (recommended), then Production.
   - Use Vercel CLI to identify the active deployment:
     - `vercel list --environment production --status READY --yes`

3) Post-deploy smoke checks (no PII)
   - Trigger cron manually once (auth required):
     - `/api/cron/background-jobs`
   - Verify advisory lock behavior:
     - Two invocations close together should yield one “locked” skip.
   - Regenerate a draft via UI (or a controlled test lead) and confirm it completes (Step 3 no longer timing out).

4) Monitor AIInteraction metrics (compare to baseline)
   - Re-run Phase 94a queries after deploy:
     - `draft.verify.email.step3` error counts and latency distribution should improve (timeouts should drop sharply).
     - `signature.context` timeout errors should drop.
     - `followup.parse_proposed_times` should have no new `max_output_tokens` incomplete errors.
     - `lead_scoring.score` should show fewer 500 failures or more successful retries.
   - Check that overall average latency doesn’t exceed acceptable thresholds for background jobs (ensure cron still completes within budget).

5) Rollback plan (fast, low-risk)
   - If Step 3 verifier becomes too slow/costly:
     - Reduce `OPENAI_EMAIL_VERIFIER_TIMEOUT_SHARE` (e.g., 0.35 → 0.25) or cap (45s → 30s).
   - If signature context extraction becomes too slow:
     - Reduce `OPENAI_SIGNATURE_CONTEXT_TIMEOUT_SHARE` or cap.
   - If cron throughput drops:
     - Increase `BACKGROUND_JOB_CRON_TIME_BUDGET_MS` (env) or reduce per-tick limit `BACKGROUND_JOB_CRON_LIMIT` to keep runs stable.
   - Code rollback only if env rollback can’t stabilize.

## Output
- Local verification complete:
  - `npm run lint` (warnings only)
  - `npm run build` (success)
- Deploy + production metrics verification: pending (requires a deploy and monitoring window).

## Handoff
Phase 94 complete once metrics show sustained improvement (monitor at least a few hours; ideally 24h) and no new regressions are detected.
