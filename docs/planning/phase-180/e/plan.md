# Phase 180e — RED TEAM Hardening Addendum (Execution Guardrails)

## Focus
Codify missing execution guardrails discovered during the RED TEAM pass without rewriting completed subphases `a` through `d`. This subphase locks decision semantics, conflict strategy, and validation diagnostics so implementation work remains deterministic under concurrent phase overlap.

## Inputs
- Root plan contract in `docs/planning/phase-180/plan.md`.
- Completed subphases:
  - `docs/planning/phase-180/a/plan.md`
  - `docs/planning/phase-180/b/plan.md`
  - `docs/planning/phase-180/c/plan.md`
  - `docs/planning/phase-180/d/plan.md`
- Verified touch points:
  - `lib/background-jobs/email-inbound-post-process.ts`
  - `lib/background-jobs/sms-inbound-post-process.ts`
  - `lib/background-jobs/linkedin-inbound-post-process.ts`
  - `lib/inbound-post-process/pipeline.ts`
  - `lib/followup-engine.ts`
  - `lib/followup-task-drafts.ts`
  - `lib/auto-send/orchestrator.ts`
  - `lib/background-jobs/maintenance.ts`
  - `actions/message-actions.ts`
  - `components/dashboard/action-station.tsx`
- Overlap phases: `175`, `176`, `177`, `178`, `179`.

## Work
1. Lock routing/sending decision matrix in implementation notes:
   - `Meeting Requested`: normal inbound draft generation remains primary; do not suppress due to broad `followUpTaskCreated`.
   - `Follow Up`: suppression allowed only for explicit timing/sequence routing conditions.
   - Process 4 (`Call Requested`):
     - with phone: draft allowed; auto-send always skipped.
     - without phone: notify/task only (no draft, no auto-send).
   - Process 5 (external scheduler link): preserve scheduler-link manual booking/task handoff independent of Process 4 no-phone branch.

2. Lock suppression predicate hardening:
   - Remove “any follow-up task exists” as a generic suppression reason.
   - Keep suppression tied to intended Follow Up timing/sequence conditions.
   - Ensure Meeting Requested does not emit “Intentional Routing” alert.

3. Lock backfill eligibility hardening:
   - Restrict `followup_task:*` draft backfill to intended follow-up classes:
     - sequence tasks (`instanceId` + `stepOrder`),
     - timing-clarify tasks (`campaignName` starts with `Follow-up timing clarification`),
     - scheduled follow-up sequence campaign (`campaignName` = `Scheduled follow-up (auto)`).
   - Exclude ad-hoc booking/manual campaigns including `lead_scheduler_link` and `call_requested`.

4. Enforce multi-agent conflict protocol for shared-file edits:
   - Before each implementation slice, run:
     - `git status --porcelain`
     - `ls -dt docs/planning/phase-* | head -10`
   - Re-read each target file immediately before editing.
   - If file-level overlap is detected, document semantic merge decisions in phase output notes.

5. Enforce replay/diagnostics completion criteria:
   - Manifest-first replay commands are required.
   - Fallback to client-based replay only if manifest creation is blocked.
   - Review replay artifacts for:
     - `judgePromptKey`
     - `judgeSystemPrompt`
     - per-case `failureType` distribution
     - critical invariant failures (`slot_mismatch`, `date_mismatch`, `fabricated_link`, `empty_draft`, `non_logistics_reply`)
   - Run baseline comparison when a prior artifact is available.

## Output
- Hardening addendum is appended with no changes to completed `a` through `d`.
- Decision matrix and backfill/suppression contracts are explicit and implementation-ready.
- Conflict-handling and replay-diagnostics requirements are written as mandatory execution gates.

## Handoff
Implementation work should execute `b` and `c` logic under this `e` guardrail contract, then run `d` validation/review requirements with replay diagnostics and conflict notes included in closeout artifacts.
