# Phase 172d — Partitioning, Backpressure, and Enterprise Quota Escalation Ladder

## Focus
Prevent throughput collapse under burst load by combining partition-aware scheduling, explicit backpressure, and gated enterprise quota escalation.

## Inputs
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-172/c/plan.md`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/prisma/schema.prisma`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/inngest/events.ts`

## Work
1. Add partitioning strategy for hot-workspace isolation (without changing core queue stack).
verify: hot workspace pressure does not degrade all partitions equally.
2. Implement explicit backpressure behavior for exhausted quota/capacity conditions.
verify: delayed work is visible with reason codes; no silent drops.
3. Implement per-workspace quota promotion/demotion logic for ladder steps (`64 -> 100`) with deterministic demotion back to `64` on breaches.
verify: each step is blocked unless guard metrics pass; demotion triggers on sustained breaches.

## Output
Partition/backpressure controls with enforceable enterprise quota ladder rules.

## Handoff
Phase 172e instruments observability and operator runbooks for these controls.
