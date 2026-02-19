# Phase 172i — Autoscale Control Loop Execution (Conservative Ramp + Reason-Code Logging)

## Focus
Implement the first execution slice of `172c`: runner-first autoscale control with conservative staged ramp, deterministic step-down, and explicit reason-code decision telemetry.

## Inputs
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-172/c/plan.md`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-172/plan.md`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/runner.ts`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/inngest/functions/process-background-jobs.ts`

## Work
1. Add autoscale decision helper(s) with locked conservative contract:
   - global target `max(1024, activeWorkspaceCount * 64)`
   - staged ramp `+64` per `5m` when healthy
   - deterministic step-down `50%` on guardrail breach, floor respected
verify: helper returns explainable `reasonCode` + `fromCapacity` + `toCapacity`.

2. Integrate autoscale decision evaluation into `processBackgroundJobs()` without breaking claim/dedupe semantics.
verify: worker concurrency selection uses autoscale output and retains bounded safety behavior.

3. Emit decision telemetry payload for every evaluation (even no-op), including:
   - `timestamp`, `fromCapacity`, `toCapacity`, `reasonCode`, `guardrailState`, `operatorOverrideActive`, `correlationId`
verify: logs contain the full decision contract fields.

4. Add focused unit coverage for decision math + guardrail step-down behavior.
verify: tests cover healthy ramp, breach step-down, floor clamp, and operator override.

## Output
- Added autoscale decision-control helper with conservative ramp/step-down contract and reason-code decision schema:
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/autoscale-control.ts`
- Integrated autoscale decision evaluation + telemetry logging into background runner:
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/runner.ts`
- Added focused unit coverage for autoscale ramp, hold window, step-down, operator override, and state application:
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/__tests__/background-job-autoscale-control.test.ts`
- Updated test orchestrator + env/readme docs for autoscale controls:
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/scripts/test-orchestrator.ts`
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/.env.example`
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/README.md`
- Coordination note: shared-file overlap with active phase-171 remains on `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/runner.ts`; autoscale integration was additive and did not modify existing lock/retry/dedupe semantics.

## Handoff
Resume `172d` ladder/promotion gating implementation after autoscale loop and telemetry contract are stable.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented autoscale decision math with locked conservative profile (`+64/5m`, breach step-down `50%`, floor `1024`, multiplier `64`).
  - Added decision logging contract fields (`timestamp`, `fromCapacity`, `toCapacity`, `reasonCode`, `guardrailState`, `operatorOverrideActive`, `correlationId`) through runner telemetry output.
  - Integrated operator override and guardrail-force env toggles for canary/staging validation.
  - Added unit coverage and wired test orchestrator entry for autoscale control tests.
- Commands run:
  - `node --import tsx --test lib/__tests__/background-job-autoscale-control.test.ts lib/__tests__/background-job-fair-scheduler.test.ts` — pass (`8/8` tests).
  - `npx eslint lib/background-jobs/autoscale-control.ts lib/background-jobs/fair-scheduler.ts lib/background-jobs/runner.ts lib/__tests__/background-job-autoscale-control.test.ts lib/__tests__/background-job-fair-scheduler.test.ts scripts/test-orchestrator.ts` — pass.
- Blockers:
  - None for `172i` implementation slice.
- Coordination notes:
  - Shared runtime overlap with phase-171 persisted; runner edits were constrained to autoscale evaluation and quota-tier source integration.
- Next concrete steps:
  - Move to `172d` implementation for real promotion gating (eligibility -> promoted quota `100`) and backpressure behavior.
  - Add staging artifact capture for autoscale decision timeline and fairness deltas.
