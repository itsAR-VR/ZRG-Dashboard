# Phase 64d — Scope Confirmation: Custom Instructions (Pricing) + Outbound Call Sites

## Focus
Lock scope decisions so Phase 64 implementation doesn’t “accidentally” sprawl:

1) Confirm the Jam “old membership fee” issue is **not** a code bug (custom instructions), so Phase 64 should not touch persona/knowledge enforcement.  
2) Decide whether the booking-link resolver change applies to **all outbound link insertions** or only specific paths.

## Inputs
- User clarification (2026-01-27): pricing drift caused by custom instructions; not required for this phase
- Call sites that emit booking links today:
  - `lib/ai-drafts.ts` (email drafts)
  - `lib/booking-process-instructions.ts` (instructions injected into outbound messages)
  - `lib/followup-engine.ts` (follow-up messages)
  - `lib/lead-scheduler-link.ts` (manual task suggestions when lead provides their own scheduler link)

## Work
1. Pricing drift scope:
   - Record: “Pricing drift is caused by custom instructions; do not change persona/knowledge handling in Phase 64.”
2. Outbound booking-link scope:
   - Decide whether to update:
     - Option A (recommended): update `resolveBookingLink()` so **all** call sites using `getBookingLink()` automatically use the branded/public override for Calendly
     - Option B: introduce a dedicated outbound resolver (e.g. `getOutboundSendLink()`) and only update AI drafts + booking process instructions

## Output
- Documented scope decisions:
  - Pricing drift out-of-scope (custom instructions)
  - Selected option for outbound booking-link call sites (A or B), with rationale

## Handoff
Proceed to Phase 64e validation with the finalized scope (booking link fix only) and the chosen outbound-call-site strategy.
