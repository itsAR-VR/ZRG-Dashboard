# Phase 146c — Draft Generation Failure Analysis (`bfb...`, `2a70...`, and Broader Cohort)

## Focus

Diagnose why draft generation fails for multiple real cases and separate true quality issues from generation/judge/infra failures.

## Inputs

- `docs/planning/phase-146/b/plan.md`
- Evidence packets for:
  - `bfbdfd3f-a65f-47e2-a53b-1c06e2b2bfc5:email`
  - `2a703183-e8f3-4a1f-8cde-b4bf4b4197b6:email`
- Top replay failures selected in 146a manifest.

## Coordination Pre-Flight (Mandatory)

- Run `git status --short` before edits.
- Re-read latest versions of files to be modified.
- For `lib/ai-drafts.ts`: symbol-anchored edits only.
- Record any merge conflicts in progress notes.

## Work

1. For each target case, classify failure stage:
   - generation never produced draft
   - draft produced but failed policy/quality
   - judge failed/truncated
   - infra failure propagated as draft failure
2. Identify shared failure clusters across cases:
   - prompt conflicts (booking-first vs sales language)
   - context incompleteness passed into generation
   - timeout/retry policy insufficient for long-context cases
   - token-budget pressure on judge/generation
3. Define fix sets by class rather than per-case one-offs.
4. Define regression fixtures and replay assertions for each class.
5. Quantify expected improvements and confidence bounds.

## Output

- Failure-cluster map with prioritized fixes.
- Case-level and cluster-level acceptance criteria ready for revision-agent consumption.

## Validation (RED TEAM)

- `npm run lint`, `npm run build`, `npm run test`
- `npm run test:ai-drafts`
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --dry-run`
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-146/replay-case-manifest.json --concurrency 3`
- Verify `bfb...` and `2a70...` evidence packets have classified failure stages and cluster assignments.

## Handoff

146d uses this cluster map as input to the revision-agent batch workflow and overseer approval loop.

## Status (RED TEAM Second Pass — 2026-02-12)

- NOT STARTED. No execution output recorded.
- Execution jumped from 146b → 146e; this subphase was skipped.
- 146e partially covered infra/judge robustness but did NOT perform the failure cluster analysis scoped here (classify `bfb...`/`2a70...` failure stages, identify shared clusters, define fix sets).
- Remaining unique work: case-level failure stage classification and cluster-prioritized fix sets for revision-agent consumption in 146d.
