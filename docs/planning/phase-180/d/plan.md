# Phase 180d — Tests + Replay Coverage + NTTAN Gates + Phase Review

## Focus
Add regression coverage for the new routing contract and validate end-to-end behavior with required AI replay gates.

## Inputs
- Phase 180a replay IDs + manifest.
- Implementation changes from 180b/180c.

## Work
1. Unit/regression tests (minimal, surgical):
   - Cover that Meeting Requested does not trigger draft suppression due to booking follow-up-task side effects.
   - Cover that Call Requested always skips auto-send (both with and without action-signal detection).
   - Cover backfill eligibility filters (sequence + timing-clarify only).

2. NTTAN validation (required):
   - `npm run test:ai-drafts`
   - Preferred (manifest-driven, if created in 180a):
     - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-180/replay-case-manifest.json --dry-run`
     - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-180/replay-case-manifest.json --concurrency 3`
   - Fallback (client-driven):
     - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --dry-run --limit 20`
     - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --limit 20 --concurrency 3`

3. Phase review write-up:
   - Create `docs/planning/phase-180/review.md` with:
     - What changed (routing contract + where enforced)
     - Evidence (tests + replay outputs)
     - Residual risks / follow-ups (if any)

## Output
- Passing test suite + required NTTAN gates.
- `docs/planning/phase-180/review.md` completed.

## Handoff
If everything passes, commit + push as a single focused change-set (or split if Phase 176–179 work must be merged first).

## Progress This Turn (2026-02-21)

### Unit/Regression
- `npm test -- lib/auto-send/__tests__/orchestrator.test.ts lib/__tests__/followup-task-drafts.test.ts`
  - Result: pass (`# pass 420`, `# fail 0`)
  - Note: test orchestrator executed the broader suite in this environment.

### NTTAN Validation
- `npm run test:ai-drafts`
  - Result: pass (`# pass 78`, `# fail 0`)
- Manifest file was missing at run start, so fallback path was used per root contract:
  - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --dry-run --limit 20`
    - Run: `ai_replay_2026-02-21T01-56-59-267Z_e1cc9d14`
    - Selected: 20 / 120
  - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --limit 20 --concurrency 3`
    - Run: `ai_replay_2026-02-21T01-57-06-050Z_45b72b6c`
    - Summary: evaluated=9, passed=8, failedJudge=1, averageScore=64.22
    - FailureTypes: `draft_quality_error=1`, all others 0
    - Critical invariants: all 0 (`slot_mismatch`, `date_mismatch`, `fabricated_link`, `empty_draft`, `non_logistics_reply`)
- Baseline compare executed (required when prior artifacts exist):
  - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --limit 20 --concurrency 3 --baseline .artifacts/ai-replay/run-2026-02-21T01-49-06-109Z.json`
    - Run: `ai_replay_2026-02-21T02-01-33-563Z_881a87f7`
    - Summary: evaluated=9, passed=9, failedJudge=0, averageScore=71.78
    - Baseline diff summary: improved=0, regressed=0, unchanged=0, newCases=20
    - FailureTypes: all 0
    - Critical invariants: all 0
- Manifest-first replay contract now executed after manifest creation:
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-180/replay-case-manifest.json --dry-run`
    - Run: `ai_replay_2026-02-21T02-11-59-663Z_0d5cb3c5`
    - Selected: 20 / 20
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-180/replay-case-manifest.json --concurrency 3`
    - Run: `ai_replay_2026-02-21T02-12-05-281Z_2088c73f`
    - Summary: evaluated=9, passed=8, failedJudge=1, averageScore=61.11
    - FailureTypes: `draft_quality_error=1`, all others 0
    - Critical invariants: all 0
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-180/replay-case-manifest.json --concurrency 3 --ab-mode overseer --baseline .artifacts/ai-replay/run-2026-02-21T02-12-05-282Z.json`
    - Run: `ai_replay_2026-02-21T02-26-44-580Z_2c8d9449`
    - Summary: evaluated=9, passed=9, failedJudge=0, averageScore=59.89
    - Baseline diff summary: improved=2, regressed=3, unchanged=4, newCases=11
    - FailureTypes: all 0
    - Critical invariants: all 0

### Replay Diagnostics (Required)
- `judgePromptKey`: `meeting.overseer.gate.v1`
- `judgeSystemPrompt` sample:
  - `You are a scheduling overseer reviewing a drafted reply. Decide whether to approve or revise it.`

### Artifacts
- `.artifacts/ai-replay/run-2026-02-21T01-56-59-267Z.json`
- `.artifacts/ai-replay/run-2026-02-21T01-57-06-050Z.json`
- `.artifacts/ai-replay/run-2026-02-21T02-01-33-563Z.json`
- `.artifacts/ai-replay/run-2026-02-21T02-11-59-664Z.json`
- `.artifacts/ai-replay/run-2026-02-21T02-12-05-282Z.json`
- `.artifacts/ai-replay/run-2026-02-21T02-26-44-581Z.json`
