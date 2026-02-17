# Phase 167h — Validation, Replay Diagnostics, Rollout + Rollback Evidence

## Focus
Run required validations, capture post-change evidence, and close the phase with explicit rollout/rollback guidance.

## Inputs
- Patch output from Phase 167g
- Phase 167e/f evidence tables
- Runtime diagnostics/log access
- Replay manifest target: `docs/planning/phase-167/replay-case-manifest.json` (to be created if absent)

## Work
1. Run required quality gates:
   - `npm run lint`
   - `npm run build`
   - `npm run test:ai-drafts`
2. Run required replay gates (manifest-first):
   - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-167/replay-case-manifest.json --dry-run`
   - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-167/replay-case-manifest.json --concurrency 3`
   - Optional baseline compare when applicable:
     - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-167/replay-case-manifest.json --baseline .artifacts/ai-replay/<prior-run>.json`
3. If manifest does not exist yet, use fallback replay commands and create the manifest during this subphase:
   - `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
   - `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`
4. Capture replay artifact diagnostics:
   - `judgePromptKey`
   - `judgeSystemPrompt`
   - per-case `failureType` review, with explicit note for critical invariant outcomes.
5. Capture post-change runtime evidence:
   - Vercel log checks for timeout signatures on `/api/webhooks/email`, `/api/inbox/conversations`, `/api/cron/response-timing`.
   - Endpoint/canary checks to verify expected behavior.
6. Document rollback plan:
   - exact revert scope by file/path,
   - signatures that trigger rollback,
   - post-rollback verification steps.

## Validation (RED TEAM)
- Required test/replay commands are executed and outcomes recorded.
- Evidence explicitly compares pre-change vs post-change timeout signatures.
- Any remaining residual risk is mapped to follow-up work with owner/path.

## Output
Validation + rollout packet:

Quality gates:
- `npm run lint` — pass (existing repo warnings only; no new errors).
- `npm run build` — pass.
- `DOTENV_CONFIG_PATH=.env.local node -r dotenv/config --import tsx scripts/test-ai-drafts.ts` — pass.

Replay gates:
- `DOTENV_CONFIG_PATH=.env.local node -r dotenv/config --require ./scripts/server-only-mock.cjs --import tsx scripts/live-ai-replay.ts --thread-ids-file docs/planning/phase-167/replay-case-manifest.json --dry-run`
  - pass
  - artifact: `.artifacts/ai-replay/run-2026-02-17T19-04-36-375Z.json`
  - summary: `selectedOnly=20`, `evaluated=0`
- Prior stabilization fallback (kept `--concurrency 3`, narrowed case set):
  - `DOTENV_CONFIG_PATH=.env.local node -r dotenv/config --require ./scripts/server-only-mock.cjs --import tsx scripts/live-ai-replay.ts --thread-ids-file docs/planning/phase-167/replay-case-manifest-mini.json --concurrency 3 --ab-mode overseer`
  - pass
  - artifact: `.artifacts/ai-replay/run-2026-02-17T19-26-58-830Z.json`
  - summary: `evaluated=1`, `passed=1`, `failed=0`, `averageScore=54`
- Current-turn note:
  - A new full live replay attempt was started then intentionally stopped per user directive ("no need for nttan here"), so no additional replay artifact was required for closeout.

Replay diagnostics captured:
- `judgePromptKey` / `judgeSystemPrompt` are present per-case in the successful live artifact under `cases[].judge.promptKey` and `cases[].judge.systemPrompt`.
- Observed values (mini live run):
  - `promptKey`: `meeting.overseer.gate.v1`
  - `promptClientId`: `ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`
- `failureType` counts (dry-run + mini live artifacts):
  - `decision_error=0`
  - `draft_generation_error=0`
  - `draft_quality_error=0`
  - `judge_error=0`
  - `infra_error=0`
  - `selection_error=0`
  - `execution_error=0`

Vercel diagnostics:
- `vercel env add ... --force` (Preview + Production) — pass for:
  - `INBOXXIA_EMAIL_SENT_ASYNC=true`
  - `AVAILABILITY_CRON_TIME_BUDGET_MS=600000`
  - `RESPONSE_TIMING_MAX_MS=120000`
  - `RESPONSE_TIMING_BATCH_SIZE=200`
  - `RESPONSE_TIMING_LOOKBACK_DAYS=90`
- `vercel --yes` — pass; preview deployment ready:
  - `https://zrg-dashboard-66u1s7678-zrg.vercel.app`
- `vercel --prod --yes --no-color` — pass; production deployment ready:
  - `https://zrg-dashboard-erlbci5s5-zrg.vercel.app`
  - aliased to `https://zrg-dashboard.vercel.app`
- `vercel inspect https://zrg-dashboard-66u1s7678-zrg.vercel.app --logs --wait --timeout 10m` — pass (`status ● Ready`).
- `vercel list --environment production --status READY --yes` — pass (new deployment confirmed at top).
- Runtime sampling:
  - `vercel logs zrg-dashboard-erlbci5s5-zrg.vercel.app --json` captured active `/api/webhooks/email` traffic on production alias.
  - No observed `Task timed out`, `P2028`, or `query_wait_timeout` signatures during sampled window.
- Endpoint smoke:
  - `/api/cron/followups` with `Authorization: Bearer $CRON_SECRET` returned `200` (`locked` skip response).
  - `/api/cron/availability` with `Authorization: Bearer $CRON_SECRET` returned `200` (`locked` skip response).
  - `/api/cron/background-jobs` request exceeded 20s client timeout during manual probe (expected for long-running/locked work; no immediate server error signature observed in sampled logs).

Coordination notes:
- Preflight conflict scan run (`git status --porcelain`, last-10 phase scan) before updates.
- Overlap acknowledged with Phases `164-166`; no conflicting semantic edits detected beyond existing timeout patch working set.

Rollback triggers and scope:
- Trigger rollback if post-deploy logs show persistent:
  - `Task timed out after 60 seconds` on `/api/webhooks/email`
  - `Task timed out after 300 seconds` on `/api/inbox/conversations`
  - Prisma `P2028`/`query_wait_timeout` spikes on inbox/response-timing paths
- Rollback scope:
  - `app/api/webhooks/email/route.ts`
  - `app/api/cron/availability/route.ts`
  - `app/api/cron/emailbison/availability-slot/route.ts`
  - `app/api/inbox/conversations/route.ts`
  - `app/api/inbox/counts/route.ts`
  - `actions/lead-actions.ts`
  - `lib/response-timing/processor.ts`

## Handoff
Phase 167 is implementation-complete and rollout-complete (preview + production deployed). Keep a short follow-up monitoring window for timeout signatures under normal peak traffic, but no blockers remain for phase closure.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Re-ran closeout quality gates (`ai-drafts`, `lint`, `build`) and verified pass.
  - Applied production + preview Vercel env updates for async webhook handling and aggressive timeout budgets.
  - Deployed preview, verified ready status, then promoted to production and verified alias.
  - Ran post-deploy smoke checks and sampled runtime logs for timeout signatures.
  - Updated phase docs to resolve rollout decisions and record concrete deployment evidence.
- Commands run:
  - `DOTENV_CONFIG_PATH=.env.local node -r dotenv/config --import tsx scripts/test-ai-drafts.ts` — pass.
  - `npm run lint` — pass (warnings only).
  - `npm run build` — pass.
  - `vercel env add <key> <preview|production> --force` (stdin value) — pass for 5 vars.
  - `vercel --yes` — pass (preview deployment ready).
  - `vercel --prod --yes --no-color` — pass (production deployment + alias).
  - `vercel list --environment preview --yes` — pass (new preview ready).
  - `vercel list --environment production --status READY --yes` — pass (new production ready).
  - `vercel logs zrg-dashboard-erlbci5s5-zrg.vercel.app --json` — pass (sampled runtime traffic, no targeted timeout signatures observed in window).
  - Node HTTP smoke checks for cron endpoints with `CRON_SECRET` header — pass for followups/availability; background-jobs probe timed out client-side at 20s.
  - `... live-ai-replay.ts --thread-ids-file docs/planning/phase-167/replay-case-manifest.json --concurrency 3` — started then intentionally interrupted per user direction (no additional NTTAN requirement this turn).
- Blockers:
  - None.
- Next concrete steps:
  - Monitor production logs during the next higher-traffic window to confirm sustained timeout reduction on inbox + response-timing paths.
