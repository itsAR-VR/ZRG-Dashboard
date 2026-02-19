# Phase 171d — Must-Have Fix: Queue Health Signals + Alerts

## Focus
Expose the exact signals needed to detect this incident class early and act quickly.

## Inputs
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-171/c/plan.md`
`BackgroundFunctionRun`, `BackgroundJob`, and `BackgroundDispatchWindow` telemetry fields.

## Work
1. Add minimal health metrics: stale-run age, due-pending count, oldest pending age.
verify: metrics are queryable in one operator query pack.
2. Add alerts for stale-run and queue-age breach.
verify: synthetic breach triggers exactly one actionable alert path.
3. Add runbook snippet for first-response actions.
verify: on-call can execute response in <10 minutes without code context.

## Output
Minimal, reliable observability for this failure mode.

## Handoff
Phase 171e is conditional and only runs if canary metrics fail.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Extended maintenance telemetry in `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/maintenance.ts`:
    - added `functionRunHealth` block for `process-background-jobs`
    - added running-count, oldest-running age, stale flag, and stale-run threshold visibility
    - emits explicit stale-run error log for operational alert pipelines
- Commands run:
  - `npm run lint` — pass
  - `npm run build` — pass
- Blockers:
  - Alert sink verification requires live canary routing confirmation.
- Next concrete steps:
  - Validate alert delivery in target engineering Slack channel during canary breach simulation.
