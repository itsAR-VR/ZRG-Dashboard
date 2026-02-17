# Phase 161 NTTAN Validation Evidence (2026-02-16)

## Why NTTAN was run
Phase 161 targets inbox read-path incident triage (`/api/inbox/conversations`), which is within message-handling scope. Per Terminus Maximus guardrails, full NTTAN validation was executed before phase closure.

## Commands + Outcomes
1. `npm run test:ai-drafts`
   - Result: **pass**
   - Summary: `68/68` tests passed

2. `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --dry-run --limit 20`
   - Result: **pass**
   - Artifact: `.artifacts/ai-replay/run-2026-02-16T20-20-11-805Z.json`
   - Summary:
     - selectedOnly: `20`
     - evaluated: `0` (dry-run)

3. `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --limit 20 --concurrency 3`
   - Result: **pass** (process exit code `0`)
   - Artifact: `.artifacts/ai-replay/run-2026-02-16T20-20-35-635Z.json`
   - Summary:
     - evaluated: `5`
     - passed: `5`
     - failed: `1` (`execution_error=1`, `error=deadline_exceeded`)
     - failedJudge: `0`
     - averageScore: `70`
     - critical invariants:
       - `slot_mismatch=0`
       - `date_mismatch=0`
       - `fabricated_link=0`
       - `empty_draft=0`
       - `non_logistics_reply=0`

## Judge Prompt Evidence
- `judgePromptKey` used: `meeting.overseer.gate.v1`
- `judgeSystemPrompt` captured to:
  - `docs/planning/phase-161/artifacts/ai-replay-judge-system-prompt.txt`
- `promptClientId` observed:
  - `ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`

## Notes
- Replay run included many skipped cases due sentiment-level draft gating (`Neutral` / `Blacklist`), which is expected policy behavior, not a replay harness failure.
- The single `execution_error=deadline_exceeded` did not produce invariant failures and did not fail the command execution.
