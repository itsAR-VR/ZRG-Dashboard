# Phase 119b — Deploy + Production Verification + Monitoring

## Focus
Deploy the Phase 119 fix set and confirm production error rates drop materially for:
- `insights.thread_extract` truncations (`max_output_tokens`)
- `email_step3_rewrite_guardrail` (Step 3 verifier)

## Inputs
- Phase 119a commits merged/pushed to the production deployment branch (typically `main`).
- Required secrets configured in Vercel:
  - `CRON_SECRET`
  - `OPENAI_API_KEY`
  - `NEXT_PUBLIC_APP_URL` (for building correct absolute URLs)

## Work
1. Deploy
   - Push commits to the repo’s prod deploy path (Git-integrated deploy or `vercel --prod`, depending on your workflow).
2. Smoke test critical endpoints (no PII; auth headers required):
   - Manually invoke:
     - `/api/cron/insights/booked-summaries`
     - `/api/cron/insights/context-packs`
   - Confirm they return success payloads and do not spam errors repeatedly.
3. Verify in-app AI Dashboard (Settings → Admin → AI Dashboard):
   - Window: `24h` (then `7d` after sufficient time)
   - Confirm `insights.thread_extract` error rate decreases vs baseline.
4. Watch Vercel logs for 10–15 minutes after deploy:
   - Ensure no new recurring error loops were introduced.

## Monitoring Thresholds (Decision-Complete)
- If `insights.thread_extract` error rate remains **>= 1%** after the deploy settles (or you still see frequent per-minute truncation errors), proceed to Phase 119c.
- If `email_step3_rewrite_guardrail` continues to trigger **>= 1%** of Step 3 calls (or drafts become noticeably degraded), proceed to Phase 119c.
- Otherwise, proceed to Phase 119d (docs/runbook updates) and close the phase.

## Output


## Handoff

## Progress This Turn (Terminus Maximus)
- Work done:
  - Confirmed deploy/log verification cannot be executed from this sandbox due to outbound DNS resolution failures.
- Commands run:
  - `vercel --yes --debug` — fails to resolve `api.vercel.com` (ENOTFOUND); deployment/list/logs commands exit without completing.
  - `curl -I https://vercel.com` — DNS resolution fails in this environment.
- Blockers:
  - Outbound DNS/network is blocked from this sandbox. Vercel (and GitHub) are unreachable, so we cannot deploy or verify production from here.
- Next concrete steps:
  - Run deploy from a normal dev environment (or CI) with network access:
    - `vercel --prod --yes` (or push to the Git-integrated branch that triggers prod deploy)
    - `vercel list --environment production --status READY --yes`
    - `vercel logs <deployment-url>`
  - Then perform the smoke checks + AI Dashboard verification steps above and fill Output/Handoff for 119b.
