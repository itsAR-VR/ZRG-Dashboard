# Phase 138b — Nearest-Slot Matching + Relative Date Resolution + Tie Policy

## Focus

Fix time matching failures by preserving exact-match fast path, adding nearest-slot fallback with configurable window, resolving `today`/`tomorrow` into weekday-aware fallback routing, and applying the approved tie policy.

## Inputs

- `lib/followup-engine.ts`
- Existing helpers:
  - `detectWeekdayTokenFromText(...)`
  - `getZonedDateTimeParts(...)`
  - `selectEarliestSlotForWeekday(...)`
- `AUTO_BOOK_SLOT_MATCH_WINDOW_MS` (new env var, default `1800000`)

## Pre-Flight Conflict Check

- [x] Re-read proposed-time match block and day-only fallback blocks on current branch state.
- [x] Reconcile overlap with phase 139 in `lib/followup-engine.ts` by symbol-based edits.

## Work

1. Added `findNearestAvailableSlot(...)` helper with configurable window matching.
2. Preserved exact-match path first; nearest-match fallback applies only when exact match fails.
3. Added `resolveRelativeDateToWeekdayToken(...)` for `today`/`tomorrow` resolution.
4. Applied relative-date resolver in both day-only fallback paths.
5. Implemented deterministic tie policy:
   - equal-distance ties select later slot (`nearest_tie_later`)
   - stored via `context.matchStrategy`
6. Extended confirmation wording with optional correction clause for tie-later bookings.
7. Preserved existing booking-gate behavior as secondary safety check.

## Validation (RED TEAM)

- `npx eslint lib/followup-engine.ts` passed.
- `npm test -- lib/__tests__/followup-engine-dayonly-slot.test.ts` included in targeted suite and passed.
- Manual code-path verification confirms:
  - exact-match remains first path,
  - nearest fallback is bounded by `AUTO_BOOK_SLOT_MATCH_WINDOW_MS`,
  - tie-later uses correction wording path.

## Output

- Matching logic now supports exact + nearest within configured window.
- Relative `today`/`tomorrow` resolves into weekday-aware fallback behavior.
- Tie policy implemented as later-slot booking with correction wording support.

## Handoff

Proceed to 138c to add/verify qualification-aware overseer extraction and booking preconditions.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented nearest-slot matching and tie policy in `lib/followup-engine.ts`.
  - Wired relative-date resolver into both day-only decision branches.
- Commands run:
  - `npx eslint lib/followup-engine.ts` — pass.
  - `npm test -- lib/__tests__/followup-generic-acceptance.test.ts lib/__tests__/followup-booking-signal.test.ts lib/__tests__/followup-engine-dayonly-slot.test.ts` — pass.
- Blockers:
  - Dedicated unit tests for nearest-slot helper/tie matrix are still pending (tracked in 138f).
- Next concrete steps:
  - Add explicit helper-level tests for exact/nearest/tie/out-of-window scenarios in 138f.
