# Phase 172g — Numeric Gate Matrix and Coordination Lock

## Focus
Finalize numeric guardrail contracts and coordination prerequisites that must exist before remaining shared-file implementation work proceeds.

## Inputs
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-172/plan.md`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-171/plan.md`
Current working tree state from `git status --short`.

## Work
1. Lock and publish numeric promotion/demotion thresholds for `64 -> 100` in root phase plan and rollout packet templates.
verify: each ladder step has explicit pass/fail thresholds and demotion triggers.

2. Execute and document conflict pre-flight before each implementation slice touching shared files:
   - `app/api/cron/background-jobs/route.ts`
   - `lib/background-jobs/runner.ts`
   - `lib/background-jobs/dispatch-ledger.ts`
   - `lib/background-jobs/maintenance.ts`
   - `lib/inngest/functions/process-background-jobs.ts`
verify: overlap notes are captured with resolution approach and owning phase.

3. Produce coordination notes for merge readiness between phase 171 and phase 172 slices.
verify: shared-file owner and sequencing notes are captured in phase artifacts before rollout execution.
4. Lock execution handoff into `172h` for tier-source migration cutover.
verify: schema + runtime ownership boundaries are explicit before migration edits begin.

## Output
Decision-locked numeric guardrail + coordination packet that removes ambiguity before scheduler/autoscale implementation.

## Handoff
Resume remaining shared-file implementation slices (`172c` onward) only after `172g` outputs are complete and conflict checks are green.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Updated root phase locks to reflect DB-backed workspace tier policy and global default quota `64`.
  - Added subphase `172h` to capture Prisma + runtime cutover from env tier allowlist to `WorkspaceSettings`.
  - Aligned subphase wording to `X=64` global target and `64 -> 100` quota policy; removed ambiguous replay language in fairness validation wording.
- Commands run:
  - `git status --short` — pass (overlap confirmed in shared runtime files).
  - `ls -dt docs/planning/phase-* | head -10` — pass (phase overlap map refreshed).
  - `rg -n ... docs/planning/phase-172` consistency sweep — pass (stale policy references identified and corrected).
- Blockers:
  - None for plan update slice.
- Coordination notes:
  - Active overlap remains with `phase-171` on `lib/background-jobs/*`, `lib/inngest/*`, and `app/api/cron/background-jobs/route.ts`.
  - Resolution: this turn restricted to planning docs only; no additional shared runtime code mutation introduced.
- Next concrete steps:
  - Execute `172h` schema/runtime tier-source migration (`WorkspaceSettings.highQuotaEnabled`) before autoscale expansion.
  - Implement `172c` runner-first autoscale control loop with reason-code evidence capture in staging simulation.
