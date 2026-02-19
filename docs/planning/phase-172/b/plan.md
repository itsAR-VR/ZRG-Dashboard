# Phase 172b — Fair Scheduler + Per-Workspace Quota Enforcement

## Focus
Implement a scheduler layer that enforces per-workspace quotas before consuming remaining global capacity.

## Inputs
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-172/a/plan.md`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/runner.ts`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/inngest/functions/process-background-jobs.ts`

## Work
1. Add quota-aware scheduling model keyed by workspace/client.
verify: each dispatch cycle enforces default/enterprise quota ceilings.
2. Preserve strict dedupe and idempotent claim semantics while introducing fairness.
verify: no customer-visible duplicate sends in scheduler simulation tests.
3. Add guardrails for hot-tenant isolation so one workspace cannot consume all workers.
verify: mixed-load simulation shows no starvation of small tenants.

## Output
- Implemented fair queue scheduling and per-workspace quota claim controls in:
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/fair-scheduler.ts`
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/runner.ts`
- Added coverage for round-robin fairness, quota parsing, and quota-aware claiming:
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/__tests__/background-job-fair-scheduler.test.ts`
- Added env/docs contract for workspace quotas:
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/.env.example`
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/README.md`
- Added new test to orchestrator:
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/scripts/test-orchestrator.ts`

## Handoff
Phase 172c adds autoscaling around the quota-aware scheduler and reuses the per-workspace quota helpers as capacity guardrail inputs.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added a pure fair-scheduler module with deterministic workspace round-robin ordering, enterprise/default quota config parsing, and quota-aware claim selection.
  - Integrated fairness queue + quota claim logic into `processBackgroundJobs()` while preserving existing job claim dedupe behavior.
  - Added focused unit tests for scheduler fairness behavior and updated the main test orchestrator list.
  - Added quota-related env and README documentation entries.
- Commands run:
  - `node --import tsx --test lib/__tests__/background-job-fair-scheduler.test.ts` — pass (`3/3` tests).
  - `node --import tsx --test lib/__tests__/background-dispatch.test.ts lib/__tests__/background-jobs-cron-no-advisory-lock.test.ts` — pass (`4/4` tests).
  - `npx eslint lib/background-jobs/fair-scheduler.ts lib/background-jobs/runner.ts lib/__tests__/background-job-fair-scheduler.test.ts scripts/test-orchestrator.ts` — pass.
- Blockers:
  - None for subphase `172b`.
- Coordination notes:
  - Shared-file overlap confirmed with active phase `171` on `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/runner.ts`.
  - Resolution: re-read current working-tree file state immediately before edits and merged fairness logic additively without altering existing stale-run recovery and dispatch-key semantics.
- Next concrete steps:
  - Start subphase `172c` by introducing autoscale control decisions and reason-code telemetry around the existing worker/quota controls.
  - Define operator override env contract for pinning/stepping capacity without changing dedupe behavior.
