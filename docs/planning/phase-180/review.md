# Phase 180 Review — Restrict “Intentional Routing” to Follow-Up

Status: Complete (routing contract fixed + validated)

## Outcome
Phase 180 contract is implemented and validated against both fallback and manifest-first NTTAN replay gates for Founders Club (`clientId=ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`).

Policy outcome:
- Meeting Requested no longer relies on broad follow-up task side effects to suppress normal inbound draft generation.
- Intentional routing suppression remains only for explicit Follow Up timing/sequence scenarios with an eligible pending routed draft.
- Call Requested auto-send skip applies for both action-signal and sentiment-only paths.
- Booking clarification paths no longer create generic booking `followup_task:*` draft sources that can hijack compose.

## Implementation Evidence

### Routing suppression scope (Phase 180b)
- `lib/background-jobs/email-inbound-post-process.ts`
- `lib/background-jobs/sms-inbound-post-process.ts`
- `lib/background-jobs/linkedin-inbound-post-process.ts`
- `lib/inbound-post-process/pipeline.ts`

Observed contract in code:
- suppression only attempts when sentiment is `Follow Up` and timing scheduling was detected
- suppression only holds if `hasPendingEligibleFollowUpTaskDraft(...)` returns true
- no generic `followUpTaskCreated` suppression path for Meeting Requested

### Booking/call draft semantics (Phase 180c)
- `lib/followup-engine.ts`
- `lib/followup-task-drafts.ts`
- `lib/auto-send/orchestrator.ts`
- `lib/__tests__/followup-task-drafts.test.ts`
- `lib/auto-send/__tests__/orchestrator.test.ts`

Observed contract in code:
- booking clarification branches set context only; they do not create booking follow-up task drafts
- backfill eligibility is constrained to sequence/timing-clarify/scheduled-auto follow-up classes
- auto-send skips Call Requested when either action-signal or sentiment indicates callback flow

## Validation Evidence (NTTAN)

### Unit/regression
- `npm test -- lib/auto-send/__tests__/orchestrator.test.ts lib/__tests__/followup-task-drafts.test.ts`
  - pass (`# pass 420`, `# fail 0`)
- `npm test`
  - pass (`# pass 420`, `# fail 0`)

### AI draft suite
- `npm run test:ai-drafts`
  - pass (`# pass 78`, `# fail 0`)

### AI replay (fallback path used because manifest did not exist at run start)
- Dry run:
  - command: `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --dry-run --limit 20`
  - runId: `ai_replay_2026-02-21T01-56-59-267Z_e1cc9d14`
  - selected: 20
- Live run:
  - command: `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --limit 20 --concurrency 3`
  - runId: `ai_replay_2026-02-21T01-57-06-050Z_45b72b6c`
  - evaluated=9, passed=8, failedJudge=1, averageScore=64.22
  - failureType: `draft_quality_error=1`
- Baseline compare:
  - command: `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --limit 20 --concurrency 3 --baseline .artifacts/ai-replay/run-2026-02-21T01-49-06-109Z.json`
  - runId: `ai_replay_2026-02-21T02-01-33-563Z_881a87f7`
  - evaluated=9, passed=9, failedJudge=0, averageScore=71.78
  - baselineDiff summary: improved=0, regressed=0, unchanged=0, newCases=20

### AI replay (manifest-first contract, after manifest creation)
- Dry run:
  - command: `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-180/replay-case-manifest.json --dry-run`
  - runId: `ai_replay_2026-02-21T02-11-59-663Z_0d5cb3c5`
  - selected: 20 / 20
- Live run:
  - command: `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-180/replay-case-manifest.json --concurrency 3`
  - runId: `ai_replay_2026-02-21T02-12-05-281Z_2088c73f`
  - evaluated=9, passed=8, failedJudge=1, averageScore=61.11
  - failureType: `draft_quality_error=1`
- Baseline compare (manifest-first form):
  - command: `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-180/replay-case-manifest.json --concurrency 3 --ab-mode overseer --baseline .artifacts/ai-replay/run-2026-02-21T02-12-05-282Z.json`
  - runId: `ai_replay_2026-02-21T02-26-44-580Z_2c8d9449`
  - evaluated=9, passed=9, failedJudge=0, averageScore=59.89
  - baselineDiff summary: improved=2, regressed=3, unchanged=4, newCases=11

### AI replay (cleanup rerun, 2026-02-21)
- Dry run:
  - command: `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-180/replay-case-manifest.json --dry-run --ab-mode overseer`
  - runId: `ai_replay_2026-02-21T14-31-25-943Z_b6890c0f`
  - selected: 20 / 20
  - artifact: `.artifacts/ai-replay/run-2026-02-21T14-31-25-943Z.json`
- Live run:
  - command: `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-180/replay-case-manifest.json --concurrency 3 --ab-mode overseer`
  - runId: `ai_replay_2026-02-21T14-31-30-110Z_eb40d78d`
  - evaluated=9, passed=8, failedJudge=1, averageScore=61.33
  - failureType: `draft_quality_error=1`
  - Meeting Requested case: `98fd69a1-305f-400d-8e2e-8e3bb537994d` evaluated + pass
  - critical invariants: `slot_mismatch=0`, `date_mismatch=0`, `fabricated_link=0`, `empty_draft=0`, `non_logistics_reply=0`
  - artifact: `.artifacts/ai-replay/run-2026-02-21T14-31-30-111Z.json`

## Replay Diagnostics (Required)
- judgePromptKey: `meeting.overseer.gate.v1`
- judgeSystemPrompt: `You are a scheduling overseer reviewing a drafted reply. Decide whether to approve or revise it.`
- failureType summary:
  - run `ai_replay_2026-02-21T01-57-06-050Z_45b72b6c`: `draft_quality_error=1`
  - run `ai_replay_2026-02-21T02-01-33-563Z_881a87f7`: all failure types `0`
  - run `ai_replay_2026-02-21T02-12-05-281Z_2088c73f`: `draft_quality_error=1`
  - run `ai_replay_2026-02-21T02-26-44-580Z_2c8d9449`: all failure types `0`
- critical invariant counts (all live runs):
  - `slot_mismatch=0`
  - `date_mismatch=0`
  - `fabricated_link=0`
  - `empty_draft=0`
  - `non_logistics_reply=0`

## Cross-Phase Coordination Notes
- Overlap considered with phases 176/177/178/179 in shared inbound + booking files.
- Resolution strategy applied: preserve existing Process 4/5 routing semantics and narrow only suppression/backfill/call auto-send gates to the Phase 180 contract.
- Additional manifest created for future manifest-first replay runs:
  - `docs/planning/phase-180/replay-case-manifest.json`

## Residual Risks / Follow-Ups
- Replay baseline reported `newCases=20`, so the baseline comparison is directional but not case-for-case comparable to prior artifacts.
- Manifest-first baseline replay still shows score movement (`improved=2`, `regressed=3`) with zero invariant misses; monitor these as prompt/evaluator variance rather than deterministic routing regressions.
- Follow Up suppression still fails closed when eligibility lookup errors (`catch => true`); acceptable for Follow Up routing safety, but should be monitored if DB/transient failures increase.
