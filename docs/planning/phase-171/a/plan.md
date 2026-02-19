# Phase 171a — Failure Contract + Acceptance Gates

## Focus
Lock one unambiguous target: prevent queue stalls from stuck runs without introducing duplicate sends.

## Inputs
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-171/plan.md`
Current queue and function-run state from `BackgroundJob`, `BackgroundFunctionRun`, and `BackgroundDispatchWindow`.

## Work
1. Define the exact stall signature (stale `RUNNING` function run + pending backlog age).
verify: signature can be measured with one SQL query pack and one threshold set.
2. Define acceptance gates for this phase (stale threshold, queue-age threshold, duplicate-send invariant).
verify: each gate has pass/fail criteria and owner metric.
3. Define rollback trigger for rollout.
verify: one deterministic rollback condition is documented.

## Output
Single-page acceptance contract used by all subsequent subphases.

## Handoff
Phase 171b implements only the must-have stale-run recovery required by this contract.
