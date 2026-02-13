# Phase 150d — Operational Guardrails (Telemetry, Health Queries, Runbook)

## Focus
Make LinkedIn/SMS reliability observable in near real time so regressions are caught before sequences silently accumulate blocked steps.

## Inputs
- `docs/planning/phase-150/b/plan.md`
- `docs/planning/phase-150/c/plan.md`
- Existing follow-up task/instance records and runtime logs

## Work
1. Add structured telemetry for key outcomes:
   - LinkedIn profile selected vs company-only skip
   - SMS phone normalization attempts and terminal failure reasons
   - skip-and-advance events by channel
2. Create Tim-scoped + global health queries:
   - due follow-up steps by channel and age bucket
   - paused/skipped reasons frequency
   - leads with company-only LinkedIn and active LinkedIn steps
3. Define lightweight operator runbook:
   - how to diagnose non-running LinkedIn/SMS quickly
   - how to confirm fix propagation after deployment
4. Document canary thresholds and escalation conditions for 150e go/no-go.

## Output
- Monitoring/query pack and incident-response runbook covering LinkedIn/SMS execution reliability.

## Handoff
Use telemetry thresholds and runbook checks as formal acceptance criteria for 150e validation and rollout.
