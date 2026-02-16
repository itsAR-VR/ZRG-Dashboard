# Phase 162b — Fix Slot-Confirmation Selection + Tests

## Focus
Eliminate incorrect “booked confirmation” rewrites caused by selecting an arbitrary offered slot when the accepted slot cannot be mapped.

## Inputs
- `docs/planning/phase-162/a/plan.md` evidence (IDs + failure patterns)
- Code:
  - `lib/ai-drafts.ts` (`applyShouldBookNowConfirmationIfNeeded`)
  - `lib/meeting-overseer.ts` (`accepted_slot_index` semantics)
  - Tests: `lib/__tests__/ai-drafts-clarification-guards.test.ts`

## Work
- Update `applyShouldBookNowConfirmationIfNeeded` selection policy:
  - Use `matchedSlot` when the draft already references a concrete offered slot label and looks like a confirmation.
  - Otherwise, only select a slot when `accepted_slot_index` is present and valid.
  - Remove any fallback to `firstOfferedSlot`.
  - If no slot can be mapped, return the original draft unchanged.
- Add/adjust regressions:
  - “slot_mismatch” regression: if draft confirms a different slot than `availability[]`, do not rewrite to the first offered slot.
  - “date_mismatch” regression: if draft references a date not in offered availability and no accepted slot index is available, do not inject a random slot.
- Run focused unit tests:
  - `npm test -- lib/__tests__/ai-drafts-clarification-guards.test.ts`

## Output
- Slot-confirmation behavior is deterministic and safe:
  - No arbitrary availability slot injection.
  - Tests encode the intended behavior.

## Handoff
- Proceed to 162c to ensure action-signal detection/Slack notify can no longer silently drop process 4 routing.
