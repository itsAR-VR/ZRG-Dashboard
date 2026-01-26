# Phase 56e — Monitoring + Cleanup (Alerts, Runbooks, Log Artifacts)

## Focus
Make the rollout observable and keep the repo tidy so future incidents can be triaged quickly.

## Inputs
- Phase 53 runbook: `docs/planning/phase-53/runbook.md`
- Phase 55 rollout checklist: `docs/planning/phase-55/c/plan.md`
- Current repo status (`git status --porcelain`)

## Work
1) **Monitoring/alerts**
   - Phase 53: monitor `/api/webhooks/email` 504s, queue drain health, inbox counts timeouts, auth noise.
   - Phase 55: monitor cron error rate and `finishedWithinBudget` failures.

2) **Runbook consolidation**
   - Ensure Phase 53 + 55 runbooks are linked from any operator-facing docs (if applicable).

3) **Repo cleanup**
   - Decide what to do with `logs_result.json` (currently untracked). If it’s a local artifact, add to `.gitignore` or remove locally.

## Output
- A short checklist of “where to look” during incidents and a decision on how to handle `logs_result.json`.

## Handoff
If monitoring reveals new systematic issues, open a new phase scoped to the biggest driver (avoid mixing unrelated fixes).

