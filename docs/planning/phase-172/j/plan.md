# Phase 172j — Promotion Gate + Backpressure Execution (Partitioned Selection + Ladder Controls)

## Focus
Implement the first `172d` execution slice: partition-aware workload selection, deterministic promotion-gate evaluation for `64 -> 100`, and explicit backpressure signaling.

## Inputs
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-172/d/plan.md`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-172/plan.md`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/runner.ts`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/fair-scheduler.ts`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/autoscale-control.ts`

## Work
1. Add partition-aware due-job selection to limit hot-workspace dominance before fair queueing.
verify: per-workspace cap is enforced in selection pool and validated by unit tests.

2. Add high-quota promotion gate with explicit reason codes and locked threshold defaults.
verify: gate evaluation is deterministic and promotion only occurs when healthy-window thresholds are met.

3. Integrate promotion decision + backpressure reason signaling into runner telemetry/outputs.
verify: runner returns/logs promotion/backpressure contracts (`reasonCode`, counts, guardrail evidence) without breaking dedupe semantics.

4. Extend targeted unit coverage for partitioning + promotion-gate behavior.
verify: tests cover healthy windows, threshold breaches, gate-open behavior, and queue-age p95 computation.

## Output
- Added partition selection helper and promotion-gate evaluator modules:
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/fair-scheduler.ts`
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/promotion-gate.ts`
- Integrated promotion/backpressure contracts into runner output:
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/runner.ts`
- Added sustained demotion semantics for promoted quota (`2` consecutive `15m` breach windows) plus immediate duplicate-send demotion behavior.
- Wired duplicate-send signal to durable `BackgroundFunctionRun` error scan with env override fallback for staging control.
- Added/updated tests for partitioning and promotion logic:
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/__tests__/background-job-fair-scheduler.test.ts`
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/__tests__/background-job-promotion-gate.test.ts`
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/scripts/test-orchestrator.ts`
- Updated env/docs for promotion/backpressure controls:
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/.env.example`
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/README.md`
- Coordination note: shared-file overlap persisted on `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/runner.ts`; changes were additive and preserved lock/claim/retry behavior.

## Handoff
Resume next `172d` slice to replace `lastError`-based duplicate signal heuristics with direct send-outcome counters and finalize promotion demotion path parity (`100 -> 64`) for sustained breach scenarios.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added partitioned pre-selection (`BACKGROUND_JOB_PARTITION_PER_WORKSPACE_CAP`) to mitigate hot-workspace dominance before fair queueing.
  - Added promotion-gate state machine with locked threshold defaults and reason-code outcomes.
  - Implemented demotion hold-down contract (`2` windows, `15m` each, failure-rate/ contention breach) and immediate demotion on duplicate-send breach.
  - Connected duplicate-send signal to durable `BackgroundFunctionRun` window scan, with env override retained for controlled staging drills.
  - Integrated promotion decision into quota resolution and explicit backpressure signaling into runner return/log output.
  - Added focused tests and docs/env controls for new behavior.
- Commands run:
  - `node --import tsx --test lib/__tests__/background-job-promotion-gate.test.ts lib/__tests__/background-job-fair-scheduler.test.ts lib/__tests__/background-job-autoscale-control.test.ts` — pass (`15/15` tests).
  - `npx eslint lib/background-jobs/promotion-gate.ts lib/background-jobs/fair-scheduler.ts lib/background-jobs/autoscale-control.ts lib/background-jobs/runner.ts lib/__tests__/background-job-promotion-gate.test.ts lib/__tests__/background-job-fair-scheduler.test.ts lib/__tests__/background-job-autoscale-control.test.ts scripts/test-orchestrator.ts` — pass.
- Blockers:
  - None for this `172j` slice.
- Coordination notes:
  - Shared-runtime overlap with active phase-171 remains; this slice stayed within scheduler-layer additive changes.
- Next concrete steps:
  - Wire duplicate-send evidence from durable store (not env control var) into promotion gate.
  - Implement explicit demotion hold-down/cooldown semantics for `100 -> 64` sustained breaches.
