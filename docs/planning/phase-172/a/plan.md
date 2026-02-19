# Phase 172a — Capacity Model + Contract Lock (Global vs Workspace)

## Focus
Define the execution-capacity contract so implementation cannot drift: what is global, what is per-workspace, and what conditions permit scaling.

## Inputs
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-172/plan.md`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-171/plan.md`
Existing durable models in `prisma/schema.prisma` (`BackgroundDispatchWindow`, `BackgroundFunctionRun`, `BackgroundJob`).

## Work
1. Lock capacity semantics:
   - global floor `1024`
   - global target `max(1024, activeWorkspaceCount * 64)`
   - no fixed planning-time upper stop; scaling remains guardrail-driven
   - default workspace quota `64`
   - workspace tier source at `WorkspaceSettings.highQuotaEnabled`
   - new workspace default stays on baseline (`highQuotaEnabled=false`, quota `64`)
verify: contracts are documented as enforceable runtime config values.
2. Define escalation ladder (`64 -> 100`) and required SLO/guard gates at each step.
verify: each step has explicit promotion and demotion criteria.
3. Define fairness and starvation-prevention policy for mixed tenant load.
verify: policy includes deterministic tie-break and no-silent-starvation rules.

## Output
Decision-complete capacity contract artifact for scheduler and autoscaler implementation.

## Handoff
Phase 172b implements scheduler logic that enforces this contract.
