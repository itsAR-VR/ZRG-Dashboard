# Phase 172c — Autoscaling Control Loop + Contention/Error Guardrails

## Focus
Add automatic global capacity scaling that increases throughput when healthy and steps down quickly when contention/error risk rises.

## Inputs
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-172/b/plan.md`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/inngest/functions/process-background-jobs.ts`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/runner.ts`

## Work
1. Implement runner-first autoscale loop for global workers with floor `1024` and workspace-scaled target `max(1024, activeWorkspaceCount * 64)`.
verify: staged ramp-up and auto step-down events emit reason codes and timestamps.
2. Define and enforce contention/error guardrails (lock waits, retry storms, failure-rate bursts).
verify: guardrail breach forces deterministic automatic step-down and logs the trigger condition.
3. Keep scaling controls feature-flagged for canary rollout and rapid rollback.
verify: operator can pin capacity and disable autoscaler without redeploy.
4. Run mixed-workspace load simulation against the fair scheduler + autoscale loop in staging.
verify: no-starvation evidence exists for small tenants under hot-tenant burst scenarios.
5. Record autoscale/staging evidence without NTTAN replay commands for this phase.
verify: `172c` artifacts include reason-code timeline and queue fairness deltas.

## Output
Deterministic autoscaling control with safety guards and operator overrides.

## Handoff
Phase 172d adds partitioning/backpressure and enterprise escalation on top of autoscaling.
