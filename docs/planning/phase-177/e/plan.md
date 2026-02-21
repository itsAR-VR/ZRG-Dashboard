# Phase 177e — Tests + NTTAN Gates + Phase Review

## Focus
Add regression coverage for Booking Process 4/5 routing eligibility + notifications + call-intent disambiguation, then run required validation gates and write the phase review.

## Inputs
- Phase 177a manifest: `docs/planning/phase-177/replay-case-manifest.json`
- Code changes from Phase 177c/177d.

## Work
- Add/extend unit tests for the routing + notification decision logic (where feasible without heavy mocking).
- Run NTTAN gates (required):
  - `npm run test:ai-drafts`
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-177/replay-case-manifest.json --dry-run`
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-177/replay-case-manifest.json --concurrency 3`
- Capture replay diagnostics for the phase review:
  - replay artifact path(s) under `.artifacts/ai-replay/*.json`
  - `judgePromptKey` and `judgeSystemPrompt`
  - per-case `failureType` counts
- Run standard repo gates:
  - `npm run lint`
  - `npm run build`
  - `npm test`
- Create `docs/planning/phase-177/review.md` capturing:
  - what changed,
  - validation evidence,
  - any known limitations/rollout considerations.

## Output
- Passing validation evidence (or documented blockers with exact unblock steps).
- `docs/planning/phase-177/review.md`

## Handoff
If all gates pass and review is written, Phase 177 is complete.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Ran full repo gates + NTTAN suite.
  - Fixed a replay failure for the explicit callback-request control case (draft was proposing a concrete time without basis) by adding a deterministic Call Requested time-clarification guard.
  - Re-ran NTTAN replay until `failureTypeCounts` were all zero.
- Commands run:
  - `npm run lint` — pass (warnings only; see `.artifacts/phase-177/validation-20260220-203921/lint.log`)
  - `npm run build` — pass (see `.artifacts/phase-177/validation-20260220-203921/build.log`)
  - `npm run test:ai-drafts` — pass
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-177/replay-case-manifest.json --dry-run` — pass
    - Artifact: `.artifacts/ai-replay/run-2026-02-21T01-40-37-081Z.json`
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-177/replay-case-manifest.json --concurrency 3` — pass (final rerun)
    - Artifact: `.artifacts/ai-replay/run-2026-02-21T01-56-50-190Z.json`
    - judgePromptKey: `meeting.overseer.gate.v1`
    - judgeSystemPrompt: `PER_CASE_CLIENT_PROMPT`
    - failureTypeCounts: `decision_error=0 draft_generation_error=0 draft_quality_error=0 judge_error=0 infra_error=0 selection_error=0 execution_error=0`
    - CriticalInvariants: `slot_mismatch=0 date_mismatch=0 fabricated_link=0 empty_draft=0 non_logistics_reply=0`
    - Note: `02b32302-a570-46f3-adf0-7889d31de062` is currently skipped by replay because draft generation is disabled for lead sentiment `"Not Interested"`.
  - `npm test` — pass (see `.artifacts/phase-177/validation-20260220-203921/test.log`)
- Blockers:
  - None.
- Next concrete steps:
  - Commit + push (exclude untracked scratch phases/images unless explicitly requested).
