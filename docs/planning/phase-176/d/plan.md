# Phase 176d — Tests + Replay Manifest + NTTAN Gates + Phase Review + Commit/Push

## Focus
Encode regressions as unit tests + replay manifest cases, then validate via NTTAN gates and ship the fix.

## Inputs
* Phase 176b + 176c code changes.
* Supabase-backed case IDs (Phase 176a).

## Work
1. Create/update replay manifest:
   - `docs/planning/phase-176/replay-case-manifest.json` with at least the Caleb Owen reschedule thread message IDs.
2. Add/update unit tests/fixtures for:
   - window mismatch => link-only,
   - no concrete date => ask-for-date draft,
   - objection routing,
   - draft not skipped when tasks are created.
3. Run NTTAN gates and record evidence:
   - `npm run test:ai-drafts`
   - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-176/replay-case-manifest.json --dry-run`
   - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-176/replay-case-manifest.json --concurrency 3`
   - Capture artifact path(s), `judgePromptKey`, `judgeSystemPrompt`, and `failureType` distribution in Output.
   - Optional baseline compare (if a prior replay artifact exists locally):
     - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-176/replay-case-manifest.json --baseline .artifacts/ai-replay/<prior-run>.json`
4. Run `$phase-review` and write `docs/planning/phase-176/review.md`.
5. Commit and push.

## Output
(Fill during execution)

## Handoff
None.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Created `docs/planning/phase-176/replay-case-manifest.json` (manifest-driven replay inputs).
  - Added regression tests for week-of-month windowing + link-only enforcement in `lib/auto-send/__tests__/revision-constraints.test.ts`.
- Commands run:
  - None (waiting on approval to run NTTAN gates + build/lint).
- Blockers:
  - Need explicit approval to run verification commands (NTTAN suite + build/lint) before marking Phase 176 complete.
- Next concrete steps:
  - Run: `npm run test:ai-drafts`
  - Run: `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-176/replay-case-manifest.json --dry-run`
  - Run: `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-176/replay-case-manifest.json --concurrency 3`
  - Then run: `npm run lint` and `npm run build`
  - Write `docs/planning/phase-176/review.md`, then commit + push.
