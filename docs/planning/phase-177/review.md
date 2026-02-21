# Phase 177 Review — Booking Process 4/5 Routing + Notification Eligibility (FC)

Status: Complete (implementation + validation complete)

## Summary
Phase 177 focused on Founders Club booking-process routing (Process 4/5) and the associated downstream actions (notifications/tasking), plus tightening call-intent disambiguation so “scheduled call” language does not get treated like a callback request.

Key outcomes:
- Booking-process routing signals are now surfaced for the correct router outcomes (4/5) regardless of sentiment, and downstream handling is invoked consistently across inbound processors.
- External scheduler link handling was hardened (including Notion `calendar.notion.so/meet/...` links) and gated to explicit instruction unless forced by booking router Process 5.
- Callback intent is treated as “Call Requested / Process 4” only when it’s truly callback intent (not “open to a quick call next week” style scheduling language).
- Added a deterministic “Call Requested time clarification” guard to prevent invented call times when a lead requests a callback without proposing a time.

## Code changes (high signal)
- Booking-process routing + signal surfacing:
  - `lib/action-signal-detector.ts`
  - `lib/ai/prompt-registry.ts`
- External scheduler link handling + tasking:
  - `lib/scheduling-link.ts`
  - `lib/lead-scheduler-link.ts`
  - `lib/background-jobs/email-inbound-post-process.ts`
  - `lib/inbound-post-process/pipeline.ts`
- Callback task creation (router-driven force path):
  - `lib/call-requested.ts`
  - `lib/background-jobs/sms-inbound-post-process.ts`
  - `lib/background-jobs/linkedin-inbound-post-process.ts`
- Draft hardening for callback requests:
  - `lib/ai-drafts.ts`
- Regression coverage:
  - `lib/__tests__/action-signal-detector.test.ts`
  - `docs/planning/phase-177/replay-case-manifest.json`

## Validation
### Standard repo gates
- `npm run lint` — pass (warnings only)
  - Evidence: `.artifacts/phase-177/validation-20260220-203921/lint.log`
- `npm run build` — pass
  - Evidence: `.artifacts/phase-177/validation-20260220-203921/build.log`
- `npm test` — pass
  - Evidence: `.artifacts/phase-177/validation-20260220-203921/test.log`

### Agentic AI/Message gate (NTTAN)
Because this phase changes AI drafting/prompt behavior and inbound message handling, full NTTAN was executed.

- `npm run test:ai-drafts` — pass
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-177/replay-case-manifest.json --dry-run` — pass
  - Artifact: `.artifacts/ai-replay/run-2026-02-21T01-40-37-081Z.json`
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-177/replay-case-manifest.json --concurrency 3` — pass (final rerun)
  - Artifact: `.artifacts/ai-replay/run-2026-02-21T01-56-50-190Z.json`
  - judgePromptKey: `meeting.overseer.gate.v1`
  - judgeSystemPrompt: `PER_CASE_CLIENT_PROMPT`
  - failureTypeCounts: `decision_error=0 draft_generation_error=0 draft_quality_error=0 judge_error=0 infra_error=0 selection_error=0 execution_error=0`
  - CriticalInvariants: `slot_mismatch=0 date_mismatch=0 fabricated_link=0 empty_draft=0 non_logistics_reply=0`

Case notes (IDs only):
- `25b16aaf-377f-478b-8ba4-7e63e7f0a8ee` — evaluated
- `02b32302-a570-46f3-adf0-7889d31de062` — skipped (draft generation disabled for lead sentiment `"Not Interested"`)
- `af92aebd-c9d1-4e23-a88e-2514c4994928` — evaluated

## Success criteria mapping
- Lead `370b29c7-3370-4bfc-824b-5c4b7172d72a` (expected Process 5 / external scheduler link handling):
  - Covered by replay case `25b16aaf-377f-478b-8ba4-7e63e7f0a8ee` (evaluated) and by the scheduler-link guard work.
- Lead `29c19fe2-8142-45f5-9f3e-795de1ae13b1` (“open to a quick call next week” should be meeting scheduling, not callback):
  - Prompt/routing changes shipped, but the current replay case is skipped due to lead sentiment gating. If we want hard replay evidence, we should swap in a case that is eligible for draft generation.
- Booking Process 4/5 notifications:
  - Action-signal detection is now invoked across inbound processors and only surfaces actionable signals when the booking-process router returns Process 4/5 (reduces missed notifications without broadening noise).
- Callback requests without a proposed time:
  - `lib/ai-drafts.ts` now forces a single time-clarification question for “Call Requested” so the system does not invent a specific call time.

## Coordination notes
At review time, the working tree also contained untracked scratch phase directories (`docs/planning/phase-178/`, `docs/planning/phase-179/`, `docs/planning/phase-180/`) and local PNG screenshots. These are intentionally not part of Phase 177 deliverables and should be excluded from the Phase 177 commit unless explicitly requested.

## Follow-ups / risks
- The soft scheduled-call disambiguation case is currently not replay-evaluated due to sentiment gating; consider replacing that replay case or adding a targeted deterministic fixture if we want hard regression coverage.
