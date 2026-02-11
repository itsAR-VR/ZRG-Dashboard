# Phase 138f — Residual Coverage + Build-Blocker Triage for Phase Exit

## Focus

Close the remaining high-signal automated coverage gaps and resolve (or explicitly classify ownership of) the build blocker so phase 138 can exit cleanly.

This subphase is intentionally marked as in-progress. `Output` and `Handoff` stay blank until execution completes.

## Inputs

- `lib/followup-engine.ts`
- `lib/__tests__/followup-engine-dayonly-slot.test.ts`
- `lib/__tests__/followup-generic-acceptance.test.ts`
- Root phase docs and validation logs from 138e

## Work

1. Add explicit automated tests for nearest-slot behavior:
   - exact match
   - nearest in-window
   - out-of-window rejection
   - equal-distance tie chooses later slot (`nearest_tie_later`)
2. Add explicit automated test for fail-closed body-grounding:
   - `accept_offered` route + `time_from_body_only=false` should create clarification path and avoid booking.
3. Re-run validation gates after coverage updates:
   - `npm run lint -- --max-warnings 9999`
   - targeted tests
   - `npm run build`
4. If build still fails:
   - capture failing route(s)/digest(s)
   - classify as external blocker or remediate if in phase-138 scope
   - document ownership decision in root plan.

## Validation (RED TEAM)

- New tests fail before fix (if behavior missing) and pass after implementation.
- No regression in blocked-sentiment and non-scheduling draft paths.
- Build result and blocker ownership explicitly documented.

## Output


## Handoff

