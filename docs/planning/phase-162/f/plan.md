# Phase 162f — NTTAN Validation + FC Replay Evidence + Commit/Push Checklist

## Focus
Validate the end-to-end behavior with the required AI regression gates and produce durable evidence (replay artifacts) that Phase 162 fixes address the observed failures without introducing new regressions.

## Inputs
- `docs/planning/phase-162/a/plan.md` evidence packet
- All code + tests changed in 162b–162e

## Work
- Local test gates (minimum):
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
- AI behavior regression suite (NTTAN required):
  - `npm run test:ai-drafts`
  - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --dry-run --limit 20`
  - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --limit 20 --concurrency 3`
- Replay evidence expectations:
  - The “direct contact number below” style case should:
    - emit a Process 4 route or `call_requested` signal
    - produce a Slack notification
    - skip auto-send if phone on file
  - Slot-confirmation cases should not rewrite to unrelated offered slots.
- Commit strategy:
  - Keep commits cohesive; prefer 1–2 commits:
    1) correctness fixes
    2) tests + fixtures
  - Include a short commit message referencing Phase 162.
- Push strategy:
  - Push branch and open PR or push directly depending on repo policy.

## Output
- Green gates for lint/build/tests.
- Replay artifact(s) saved in `.artifacts/ai-replay/*` (gitignored) and summarized in Phase 162 root plan.
- Commits created and pushed.

## Handoff
- Update `docs/planning/phase-162/plan.md` with a brief Phase Summary including:
  - which files changed
  - test command outputs (pass/fail)
  - replay pass rate and notable failures (if any)
