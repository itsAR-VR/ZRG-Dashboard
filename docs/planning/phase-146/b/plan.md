# Phase 146b — Case 1 Deep Dive: Booking-First Miss (`59dc...`) and Execution Drift

## Focus

Resolve why a clearly bookable lead was not moved directly to booking despite compatible requested windows.

## Inputs

- `docs/planning/phase-146/a/plan.md`
- Evidence packet for `59dcfea3-84bc-48eb-b378-2a54995200d0:email`
- Booking/timezone/orchestration surfaces:
  - `lib/meeting-overseer.ts`
  - `lib/ai-drafts.ts`
  - `lib/followup-engine.ts`
  - `lib/timezone-inference.ts`

## Coordination Pre-Flight (Mandatory)

- Run `git status --short` before edits.
- Re-read latest versions of `lib/meeting-overseer.ts`, `lib/ai-drafts.ts`, `lib/followup-engine.ts`, `lib/timezone-inference.ts`.
- For `lib/ai-drafts.ts` (7+ phase hot spot): use symbol-anchored edits only.
- Record any merge conflicts and resolution in progress notes.

## Work

1. Trace full path for this case end-to-end:
   - extraction outputs
   - response mode decision
   - booking slot selection
   - drafted outbound
   - judge verdict and invariant failures
2. Identify exact drift source(s):
   - AI extraction ambiguity
   - prompt hierarchy conflict
   - execution-layer branch override
   - timezone normalization mismatch
3. Define durable remediation pattern for booking-first handling:
   - when to suppress extra selling
   - when to include only booking-forward + direct answer content
   - how timezone is rendered in lead-local terms only
4. Add explicit acceptance invariants for this case:
   - no re-qualification language
   - no off-window timezone conversion artifacts
   - direct booking-forward messaging tone

## Output

- Root-cause analysis and remediations for `59dc...` with explicit invariant checklist.
- A reusable booking-first decision trace format for future similar failures.

## Validation (RED TEAM)

- `npm run lint`, `npm run build`, `npm run test`
- `npm run test:ai-drafts`
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-145/replay-case-manifest.json --dry-run`
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-145/replay-case-manifest.json --concurrency 3`
- Verify `59dc...` evidence packet shows root cause identified and invariant checklist defined.

## Handoff

146c applies the same method to draft-generation failures and generalizes to the wider failure cohort.

## Output (2026-02-12 10:21 UTC)

- Implemented explicit inbound time-window handling in draft availability selection (`lib/ai-drafts.ts`):
  - `extractTimingPreferencesFromText()` now parses explicit ranges such as `between 12pm and 3pm`, `from 12 to 3pm`, and `9-11am`.
  - Candidate slot filtering now applies weekday + relative-week + explicit time-window constraints before distributed slot selection.
  - When explicit time windows are present, previously offered-slot exclusion is disabled to avoid pushing leads to next-week alternatives.
- Added parser coverage tests in `lib/__tests__/ai-drafts-timing-preferences.test.ts`.
- Targeted replay evidence for `59dc...` with `--overseer-mode fresh` now produces in-window options:
  - Draft: `Fri, Feb 13` with `12:30 PM PST` and `1:30 PM PST` (previous stale run offered `Fri, Feb 20`).
  - Artifact: `.artifacts/ai-replay/phase146-target3-refresh-ab.json`.
- Remaining failure reason for `59dc...` is no longer wrong-day/wrong-window selection; judge now flags phrasing polish (window-confirmation wording), not booking-window mismatch.
