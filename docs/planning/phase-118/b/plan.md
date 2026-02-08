# Phase 118b — Production Deploy + Smoke Verification (Jam Repro)

## Focus
Deploy the Phase 117 fixes to production and validate, using the Jam repro as the primary acceptance test for launch readiness.

## Inputs
- Latest production deployment URL (Vercel)
- `AGENTS.md` Vercel CLI workflow + log commands
- Phase 117 runbook draft: `docs/planning/phase-117/e/plan.md`

## Work
0. Pre-flight: Production env sanity
   - Confirm Vercel Production env vars are set before deploy:
     - `NEXT_PUBLIC_APP_URL=https://app.codex.ai`
     - `SERVER_ACTIONS_ALLOWED_ORIGINS=app.codex.ai,cold2close.ai,*.cold2close.ai,zrg-dashboard.vercel.app` (if multi-domain access is intended)

1. Deploy
   - Default assumption: production deploy is Git-integrated on push to `main`.
   - Option A (Git-integrated):
     - `git push origin main`
     - Wait for Vercel “Production” deployment to reach READY.
   - Option B (Vercel CLI):
     - `vercel --prod`

2. Production smoke (must pass)
   - Login works (no redirect loop).
   - Master Inbox loads conversations:
     - Selecting a workspace loads a first page.
     - **All Workspaces** loads a first page.
   - Filters do not crash (including empty/default filter states).
   - No repeated 500s in network logs (confirm no poll-driven error loop).

3. Logs (if failures)
   - Use Vercel logs to find the concrete runtime error behind any UI digest:
     - `vercel list --environment production --status READY --yes`
     - `vercel logs <deployment-url>`
   - If `ref: <debugId>` is shown in UI, search logs for that debugId.

## Output
- Evidence that the Jam repro is resolved in production and Inbox is stable.

## Handoff
- Proceed to Phase 118c/118d for custom-domain readiness + security/ops audit.
