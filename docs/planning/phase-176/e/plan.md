# Phase 176e — Tests + NTTAN Validation + Review Notes

## Focus
Add regression tests for soft-call vs callback-request behavior and run mandatory NTTAN validation.

## Inputs
- Implemented verifier + routing/sentiment integrations from 176b–176d

## Work
- Tests:
  - Add/extend unit tests covering:
    - Router returns process `4` but verifier says schedule_call → final route != 4 and no call signal.
    - Verifier confirms callback_request → route 4 and call signal preserved.
    - Sentiment correction: initial Call Requested + schedule_call → stored Meeting Requested.
- NTTAN:
  - `npm run test:ai-drafts`
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-176/replay-case-manifest.json --dry-run`
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-176/replay-case-manifest.json --concurrency 3`
- Record artifacts paths + outcomes in this subphase Output.

## Output
- Tests passing and NTTAN evidence recorded (or blockers explicitly documented).

## Handoff
If all subphases complete, trigger phase review (`docs/planning/phase-176/review.md`) and summarize rollout verification steps.

