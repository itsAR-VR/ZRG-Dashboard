# Phase 118a — Consolidate, Verify, and Commit Phase 117 Fix Set

## Focus
Get the Phase 117 fix set into a clean, reviewable, and shippable state: ensure all changes are intentional, re-run quality gates, and commit code + planning docs in a predictable structure.

## Inputs
- Phase 117 planning: `docs/planning/phase-117/plan.md`
- Phase 117 subphases: `docs/planning/phase-117/a/plan.md` … `docs/planning/phase-117/e/plan.md`
- Local working tree changes (expected to include inbox hardening + docs)

## Work
1. Pre-flight (multi-agent + repo state)
   - `git status --porcelain=v1 -b` and confirm every modified file maps to Phase 117/118 scope.
   - Scan last 10 phases: `ls -dt docs/planning/phase-* | head -10` and confirm no conflicting “active” work touching the same files.

2. Ensure planning docs are tracked
   - Add `docs/planning/phase-117/` (currently untracked in this workspace) and `docs/planning/phase-118/`.
   - Commands:
     - `git add docs/planning/phase-117 docs/planning/phase-118`

3. Re-run local quality gates (must be green before commit)
   - `npm run typecheck`
   - `npm test`
   - `npm run lint`
   - `npm run build`

4. Commit strategy (decision-complete)
   - Commit 1 (code): Inbox launch blocker fix + hardening.
     - Include: `actions/*`, `app/*`, `components/*`, `lib/*`, `next.config.mjs`, `scripts/test-orchestrator.ts`
     - Commands:
       - `git add actions app components lib next.config.mjs scripts/test-orchestrator.ts`
       - `git commit -m "fix(inbox): prevent server action 500s + harden launch path"`
   - Commit 2 (docs): planning docs updates.
     - Include: `docs/planning/phase-117/**`, `docs/planning/phase-118/**`
     - Commands:
       - `git add docs/planning/phase-117 docs/planning/phase-118`
       - `git commit -m "docs(planning): phase 117-118 launch readiness"`

## Output
- Working tree prepared for commit (code + planning docs), with local quality gates passing:
  - `npm run typecheck` — pass
  - `npm test` — pass
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass
- Calendly webhooks now enforce signature verification in production (fails closed when misconfigured).
- Custom-domain readiness documented for `cold2close.ai` + `app.codex.ai` and Server Actions allowlisting remains env-driven.
- `getPublicAppUrl()` now requires `NEXT_PUBLIC_APP_URL`/`APP_URL` in production so generated links + webhook callback URLs use the intended domain.

## Handoff
- Commit changes (code first, then planning docs), push to `main` to deploy, then proceed to Phase 118b production smoke verification.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Pulled Jam artifacts via Jam MCP; confirmed production was POSTing invalid Server Action params (`clientId:{}`, `cursor:{}`) and receiving repeated 500s.
  - Enforced Calendly webhook signature verification in production (missing key now returns 5xx; invalid signature returns 401).
  - Hardened public URL handling for custom domains by requiring `NEXT_PUBLIC_APP_URL`/`APP_URL` in production, and removed hardcoded `zrg-dashboard.vercel.app` defaults from webhook URL UI/docs.
  - Updated Phase 117/118 planning docs to reflect the resolved launch decisions (domains + deploy path + signing-key enforcement).
- Commands run:
  - `npm run typecheck` — pass
  - `npm test` — pass
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass
- Blockers:
  - Git commit + push must be done outside this environment (deploy is “push to `main`”).
  - Vercel Production env must include `NEXT_PUBLIC_APP_URL` (required) before deploy.
- Next concrete steps:
  - Set Vercel Production env:
    - `NEXT_PUBLIC_APP_URL=https://app.codex.ai`
    - `SERVER_ACTIONS_ALLOWED_ORIGINS=app.codex.ai,cold2close.ai,*.cold2close.ai,zrg-dashboard.vercel.app`
  - Commit (two commits, per this plan) and push to `main`.
  - Run Phase 118b production smoke checklist.
