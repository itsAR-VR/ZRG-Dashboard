# Phase 117e — Launch + Rollback Runbook (Deploy, Monitor, Recover)

## Focus
Ship the Phase 117 fixes safely, verify in production quickly, and document clear rollback/recovery steps for inbox availability incidents.

## Inputs
- Phase 117d checklist (env + cron/webhook auth + smoke)
- Phase 116 runbook (auto-send revision canary): `docs/planning/phase-116/e/plan.md`
- Vercel CLI workflow notes: `AGENTS.md`

## Work
1. Deploy sequence (recommended)
   - Deploy Phase 117 with conservative defaults (no behavior changes beyond inbox reliability).
   - Immediately smoke test:
     - `/` loads after login and Master Inbox renders without the Server Components error message.
     - Workspaces load and selecting a workspace loads conversations.

2. Monitoring (first 30–60 minutes)
   - Watch Vercel runtime logs for:
     - Server Action 500s
     - DB connectivity errors (P1001)
     - Supabase auth failures (refresh_token / missing session)
   - If Phase 117c added `debugId` logging, confirm error logs include it.

3. Rollback / recovery (RT-10 — concrete procedure)
   - **Decision threshold:** rollback if > 3 unique Server Action 500 errors in the first 10 minutes post-deploy.
   - **Identify last-good deployment:**
     - `vercel list --environment production --limit 5` → note the deployment URL before the Phase 117 deploy.
   - **Execute rollback:**
     - `vercel promote <last-good-deployment-url>` or use Vercel dashboard → Deployments → Promote to Production.
   - **Verify rollback success:**
     - Login → confirm Master Inbox loads conversations (even if with the original 500 bug, at least it's a known state).
     - `vercel logs <deployment-url>` → confirm no new error patterns.
   - If Master Inbox fails due to env/runtime:
     - verify Vercel env vars (Phase 117d list) and redeploy.
   - If DB outage:
     - follow existing DB retry/fail-closed patterns; do not spam retries from crons.
   - **RT-4 / RT-NEW-2 note:** Intermittent "Not authenticated" errors in logs may indicate **Supabase latency** (middleware timeout → fail-open → stale cookies → Server Action auth timeout), NOT actual missing credentials. Check for `AbortError` patterns in logs before treating as an auth regression.

4. Integrate with Phase 116 canary (optional, after inbox stability)
   - Once Master Inbox stability is confirmed, proceed with Phase 116 canary steps:
     - keep `AUTO_SEND_REVISION_DISABLED=1` until ready
     - enable revision for one workspace via control plane
     - monitor attempted/applied metrics

## Planned Output
- A production deploy + rollback runbook that treats Master Inbox availability as a launch-blocker SLO.

## Planned Handoff
- If launch reveals new issues, open a new phase scoped to only the new incident class (do not balloon Phase 117).

## Output

## Handoff
