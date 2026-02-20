# Phase 175e — Manifest-Driven Replay + Coordination Closeout

## Focus
Close the remaining RED TEAM gaps that were not explicitly covered in 175a-175d: deterministic replay evidence and conflict-aware execution notes for shared follow-up/inbound files.

## Inputs
* Root plan RED TEAM findings in `docs/planning/phase-175/plan.md`
* Replay manifest scaffold: `docs/planning/phase-175/replay-case-manifest.json`
* Existing replay artifact outputs in `.artifacts/ai-replay/*.json`
* Shared-file overlap set:
  * `lib/followup-timing.ts`
  * `actions/message-actions.ts`
  * `lib/inbound-post-process/pipeline.ts`
  * `lib/background-jobs/email-inbound-post-process.ts`
  * `lib/background-jobs/sms-inbound-post-process.ts`
  * `lib/background-jobs/linkedin-inbound-post-process.ts`

## Work
1. Before each implementation slice, run pre-flight conflict checks:
* `git status --porcelain`
* re-read target files immediately before edit
* if overlap is detected, record `Issue/Cause/Resolution/Files affected` in the active subphase Output.
2. Curate manifest cases in `docs/planning/phase-175/replay-case-manifest.json`:
* prioritize no-date deferrals, soft-not-interested deferrals, hard-no responses, and multi-channel clarify attempts.
* include at least one LinkedIn clarifier scenario if available.
3. Execute replay validations in this order:
* `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-175/replay-case-manifest.json --dry-run`
* `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-175/replay-case-manifest.json --concurrency 3`
* fallback (only when manifest yields no usable cases):
  * `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
  * `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`
* merge policy: manifest-first is required as primary path, but client-id fallback satisfies the gate when manifest selection is empty.
4. Record replay diagnostics from the generated artifact JSON:
* `judgePromptKey`
* `judgeSystemPrompt`
* per-case `failureType` counts and representative failures.
5. If a prior replay artifact exists, run baseline comparison:
* `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-175/replay-case-manifest.json --baseline .artifacts/ai-replay/<prior-run>.json`

## Validation (RED TEAM)
* Manifest commands execute against an on-disk manifest file (no missing-path failures).
* Replay closeout notes include prompt metadata and `failureType` diagnostics.
* Conflict logs are present whenever shared-file overlaps are encountered.

## Output
* Manifest curation completed:
  * `docs/planning/phase-175/replay-case-manifest.json` now contains 20 concrete thread IDs spanning no-date deferrals, soft-not-interested deferrals, and follow-up clarify paths.
* Manifest-first replay execution completed:
  * Dry run: `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-175/replay-case-manifest.json --dry-run` -> PASS (20 selected)
    * Artifact: `.artifacts/ai-replay/run-2026-02-20T07-30-51-958Z.json`
  * Live replay: `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-175/replay-case-manifest.json --concurrency 3` -> PASS
    * Artifact: `.artifacts/ai-replay/run-2026-02-20T07-30-57-775Z.json`
    * Summary: evaluated=17, passed=14, failedJudge=3, failed=0, avg=58.76
    * FailureTypes: `draft_quality_error=3`, all others `0`
    * Critical invariants: all `0` (`slot/date/link/empty/non_logistics`)
    * AB summary:
      * off: 16/17
      * platform: 15/17
      * overseer: 14/17
      * force: 16/17
* Required baseline comparison executed (prior artifact present):
  * `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-175/replay-case-manifest.json --baseline .artifacts/ai-replay/run-2026-02-20T07-19-11-333Z.json` -> PASS
  * Artifact: `.artifacts/ai-replay/run-2026-02-20T08-00-36-703Z.json`
  * Baseline diff: `improved=3, regressed=4, unchanged=10, new=3`
  * Summary: evaluated=17, passed=15, failedJudge=2, failed=0, avg=59.24
  * FailureTypes: `draft_quality_error=2`, all others `0`
  * Critical invariants: all `0`
* Replay diagnostic metadata captured:
  * Non-null judge prompt key: `meeting.overseer.gate.v1`
  * Judge system prompt present (starts: "You are a scheduling overseer reviewing a drafted reply...")
  * Prompt client id: `ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`
* Coordination/conflict notes:
  * Pre-flight overlap checks were run against expected shared files before finalization (`git status --short`).
  * No unexpected cross-phase merge conflicts were encountered.
  * Two compile-time issues surfaced during closeout and were fixed directly in-scope:
    * transaction array promise typing (`actions/message-actions.ts`)
    * missing pipeline stage union literal (`lib/inbound-post-process/types.ts`)

## Handoff
Phase 175 replay evidence and coordination closeout are complete; handoff is to root phase closeout (`docs/planning/phase-175/plan.md`) for final status and git shipment.
