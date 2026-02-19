# Phase 171e — Conditional Hardening (Only If Canary Fails)

## Focus
Apply additional complexity only if must-have fixes do not meet acceptance gates.

## Inputs
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-171/d/plan.md`
Canary metrics and alert outcomes from must-have rollout.

## Work
1. Identify which acceptance gate failed (stale-run, queue-age, duplicate invariant).
verify: single failed gate is named with evidence.
2. Choose one targeted hardening change tied to that failed gate.
verify: change scope is minimal and reversible.
3. Re-run only the failing gate validation.
verify: failed metric now passes without new regressions.

## Output
Targeted remediation only when data proves it is required.

## Handoff
Phase 171f finalizes go/no-go with full validation set.
