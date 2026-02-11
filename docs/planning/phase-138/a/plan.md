# Phase 138a — AutoBookingResult/Context Foundation + Full Return-Path Coverage

## Focus

Extend `processMessageForAutoBooking()` to return structured scheduling + qualification context on every return path, and guarantee that every scheduling follow-up task creation is reflected in the returned context.

## Inputs

- `lib/followup-engine.ts` (`processMessageForAutoBooking`)
- Runtime callsites:
  - `lib/inbound-post-process/pipeline.ts`
  - `lib/background-jobs/email-inbound-post-process.ts`
  - `lib/background-jobs/sms-inbound-post-process.ts`
  - `lib/background-jobs/linkedin-inbound-post-process.ts`
- Test touchpoint:
  - `lib/__tests__/followup-generic-acceptance.test.ts`

## Pre-Flight Conflict Check

- [x] Re-read `lib/followup-engine.ts` current function shape before edits.
- [x] Confirm current return count and direct `followUpTask.create` branches.
- [x] Confirm overlap with active phases (137/139/140) and merge on current file state.

## Work

1. Added `AutoBookingFailureReason`, `AutoBookingTaskKind`, `AutoBookingMatchStrategy`, `AutoBookingContext`, and `AutoBookingResult` types.
2. Added `defaultAutoBookingContext(...)` and normalized result helpers (`makeResult`/`fail`) in `processMessageForAutoBooking(...)`.
3. Updated `processMessageForAutoBooking(...)` return signature to `Promise<AutoBookingResult>`.
4. Ensured all return paths include context + explicit failure reason.
5. Added/used task-context marker helper so follow-up task creation sets context consistently.
6. Updated blocked-sentiment test assertions to validate `context.failureReason`.

## Validation (RED TEAM)

- `rg -n "processMessageForAutoBooking\(" -g '*.ts'` used to verify callsites.
- `npx eslint lib/followup-engine.ts lib/background-jobs/email-inbound-post-process.ts lib/background-jobs/sms-inbound-post-process.ts lib/background-jobs/linkedin-inbound-post-process.ts lib/inbound-post-process/pipeline.ts` passed.
- `npm test -- lib/__tests__/followup-generic-acceptance.test.ts lib/__tests__/followup-booking-signal.test.ts lib/__tests__/followup-engine-dayonly-slot.test.ts` passed (full orchestrator run: 332 pass / 0 fail).

## Output

- `lib/followup-engine.ts` now returns `AutoBookingResult` with context on every path.
- Context fields now include route, match strategy, qualification summary, and failure reason taxonomy.
- Task-creation branches now annotate context for downstream suppression logic.
- `lib/__tests__/followup-generic-acceptance.test.ts` updated for new return shape.

## Handoff

Proceed to 138b for slot matching and relative-date behavior fixes using the new context foundation.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Completed result/context foundation and return-path normalization.
  - Verified no regressions in blocked-sentiment fast-fail behavior.
- Commands run:
  - `rg -n "processMessageForAutoBooking\(" -g '*.ts'` — pass.
  - `npx eslint ...` (targeted files) — pass.
  - `npm test -- lib/__tests__/followup-generic-acceptance.test.ts lib/__tests__/followup-booking-signal.test.ts lib/__tests__/followup-engine-dayonly-slot.test.ts` — pass.
- Blockers:
  - None in subphase 138a scope.
- Next concrete steps:
  - Keep return-shape guarantees intact while completing slot/qualification/pipeline hardening in later subphases.
