# Phase 106e — Bug: AI suggesting 2 calendar slots but 1 is blank + over-explaining after “yes”

## Focus
Fix availability slot formatting so no blank slot is emitted, and ensure the AI response after a “yes” confirmation stays concise and does not over-explain.

## Inputs
- Monday item: “AI suggesting 2 calendar slots but 1 is blank + AI providing more info about calls to people who have already said yes”
- Jam: https://jam.dev/c/780becbd-0a32-4817-93ab-30ee41d45a58
- Availability logic: `lib/availability-format.ts`, `lib/availability-distribution.ts`, `lib/slot-offer-ledger.ts`
- Draft generation: `lib/ai-drafts.ts`, `lib/ai/prompt-registry.ts`

## Work
1. Reproduce and isolate whether the blank slot comes from formatting or from slot selection.
2. Trace availability list generation and confirm non-empty slot labels.
3. Check prompt instructions for post-acceptance messaging and any branching logic.
4. Define fixes: validation for empty slots + tighten prompt/output rules.
5. Define tests: unit for slot formatting + regression check for post-yes response.

## Output
- Fix plan with precise validation points and prompt adjustments.

## Handoff
Implement validation + prompt updates and verify via Jam repro.
