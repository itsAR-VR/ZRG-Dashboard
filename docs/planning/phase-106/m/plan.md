# Phase 106m — Implementation: Availability Blank‑Slot Guard + Tests

## Focus
Prevent blank/invalid availability slots from reaching AI prompts and add regression coverage.

## Inputs
- Availability formatting: `lib/availability-format.ts`
- Auto-booking slot selection: `lib/followup-engine.ts`

## Work
1. Add guards to skip empty/invalid slot values before formatting.
2. Add unit tests for formatting + deterministic selection.

## Output
- No blank slots in availability lists; tests verify behavior.

## Handoff
Proceed to validation + QA (Phase 106n).
