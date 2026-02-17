# Phase 166c — Revision Constraints + Invariant Alignment

## Focus
Make the revision loop unable to “fix” a mismatch by inventing a time; it must either pick a matching offered slot or use the known scheduling link when no match exists.

## Inputs
- Policy + cases from Phase 166a.
- Replay invariants: `lib/ai-replay/invariants.ts` (`slot_mismatch`, `date_mismatch`).
- Revision constraint pipeline: `lib/auto-send/revision-constraints.ts` + `validateRevisionAgainstHardConstraints()`.

## Work
- Ensure inbound window parsing covers:
  - weekday,
  - time-of-day words (morning/afternoon/evening),
  - explicit ranges (between/from/12–3pm).
- Tighten validation rules:
  - when inbound expresses a window and no offered slot matches it, require known scheduling link in the revised draft,
  - preserve one-slot rule for windows when matches exist.
- Add unit tests in `lib/auto-send/__tests__/revision-constraints.test.ts`.
- Ensure these tests run in the default AI test bundle (`scripts/test-ai-drafts.ts`).

## Output
- Revision constraints tests pass and revision-loop behavior is policy-compliant.

## Handoff
- Phase 166d runs NTTAN replay gates to validate end-to-end behavior on real cases.

