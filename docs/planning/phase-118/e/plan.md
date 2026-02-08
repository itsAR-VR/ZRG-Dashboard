# Phase 118e — Final Runbook + Phase 116 Canary Scheduling

## Focus
Produce a decision-complete launch + rollback runbook and sequence post-inbox follow-ups (Phase 116 canary) without risking launch stability.

## Inputs
- Phase 117e (rollback runbook draft): `docs/planning/phase-117/e/plan.md`
- Phase 116 canary steps: `docs/planning/phase-116/e/plan.md`
- Vercel workflow: `AGENTS.md`

## Work
1. Finalize launch runbook
   - Include:
     - production smoke checklist (from Phase 118b)
     - log triage workflow (including `ref: <debugId>` searching)
     - explicit rollback threshold + steps (`vercel list`, `vercel promote`, verification)
   - Default rollback threshold (decision-complete):
     - Roll back if you observe > 3 unique Server Action 500s within 10 minutes post-deploy.
   - Rollback commands (Vercel CLI):
     - `vercel list --environment production --status READY --yes`
     - `vercel promote <last-good-deployment-url>`
     - `vercel logs <deployment-url>` (confirm error rate drops)

2. Phase 116 canary scheduling (after inbox stability)
   - Only after Phase 118b confirms inbox stability:
     - Execute Phase 116 canary steps for exactly one workspace.
     - Monitor attempted/applied metrics for 30–60 min before expanding.

## Output
- A concrete runbook usable by an operator to launch, monitor, and rollback quickly.

## Handoff
- If new issues are discovered, open a new phase scoped only to the new incident class.
