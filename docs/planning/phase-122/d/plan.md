# Phase 122d — Prompt Tightening + Unit Tests + Validation

## Focus
Lock in the new agent-driven contract with:
- prompt tightening for `meeting.overseer.extract.v1` (no key bump)
- unit tests for booking signal derivation and route selection
- full local validation (`npm test`, `npm run lint`, `npm run build`)

## Inputs
- Phase 122a–c outputs
- Meeting Overseer prompt sources (keep consistent):
  - `lib/meeting-overseer.ts` (`systemFallback` rules)
  - `lib/ai/prompt-registry.ts` (`MEETING_OVERSEER_EXTRACT_SYSTEM_TEMPLATE`)
- Test harness: `scripts/test-orchestrator.ts` and `lib/__tests__/*` (Node `node:test`)

## Work
1. Tighten the Meeting Overseer extraction instructions (no prompt key bump):
   - **Both locations must be updated in sync:**
     - `lib/ai/prompt-registry.ts`: `MEETING_OVERSEER_EXTRACT_SYSTEM_TEMPLATE` at line 498
     - `lib/meeting-overseer.ts`: `systemFallback` string at line 272
   - Tightening rules:
     - `acceptance_specificity="generic"` MUST only be used for standalone scheduling acknowledgements (e.g., "Yes", "Sounds good", "That works") in response to offered slots. Do NOT set "generic" for:
       - Non-scheduling replies ("Thanks for the info", "I'll review this")
       - Requests for more information ("Can you send details?")
       - Long messages with tangential scheduling references
     - `intent="decline"` MUST be used for explicit rejections ("not interested", "no thanks", "stop", "cancel")
     - `intent="other"` MUST be used for non-scheduling messages regardless of thread context
     - Add instruction: "If the message is ambiguous about scheduling, prefer `intent: 'other'` over `intent: 'accept_offer'` (fail closed)."
   - Keep `meeting.overseer.extract.v1` key unchanged.
2. Add unit tests for routing decisions without live LLM calls:
   - New file: `lib/__tests__/followup-booking-signal.test.ts`
   - Tests feed synthetic `MeetingOverseerExtractDecision` objects into `deriveBookingSignal(...)`:
     - `{ is_scheduling_related: true, intent: "accept_offer", acceptance_specificity: "generic" }` + hasOfferedSlots → `{ wantsToBook: true, route: "accept_offered" }`
     - `{ is_scheduling_related: true, intent: "accept_offer", acceptance_specificity: "specific" }` + hasOfferedSlots → `{ wantsToBook: true, route: "accept_offered" }`
     - `{ is_scheduling_related: false, intent: "other" }` → `{ wantsToBook: false, route: "none" }`
     - `{ is_scheduling_related: true, intent: "decline" }` → `{ wantsToBook: false, route: "none" }`
     - `{ is_scheduling_related: true, intent: "propose_time" }` → `{ wantsToBook: true, route: "proposed_time" }`
     - `{ is_scheduling_related: true, intent: "request_times" }` → `{ wantsToBook: false, route: "none" }` (asking for times, not providing)
     - `{ is_scheduling_related: true, intent: "reschedule" }` → `{ wantsToBook: false, route: "none" }` (change existing, not book new)
     - `null` overseer (API failure) → `{ wantsToBook: false, route: "none" }`
     - Day-only: `{ intent: "accept_offer", acceptance_specificity: "day_only", preferred_day_of_week: "thu" }` + hasOfferedSlots → route should carry through weekday token
   - Wire into `scripts/test-orchestrator.ts`.
3. Run validation commands:
   - `npm test` — all tests pass (including Phase 121 tests)
   - `npm run lint` — no new errors
   - `npm run build` — TypeScript compiles

## Validation (RED TEAM)
- Verify prompt changes are in sync between `prompt-registry.ts` and `meeting-overseer.ts`.
- Verify `deriveBookingSignal` test file is wired into `scripts/test-orchestrator.ts`.
- Verify `npm test && npm run lint && npm run build` all pass.
- Verify Phase 121 tests (`followup-generic-acceptance.test.ts`, `email-cleaning.test.ts`) still pass.

## Output
- Tightened Meeting Overseer extract instructions (no key bump), in sync across:
  - `lib/ai/prompt-registry.ts` (`MEETING_OVERSEER_EXTRACT_SYSTEM_TEMPLATE`)
  - `lib/meeting-overseer.ts` (`systemFallback`)
  - Key change: `acceptance_specificity="generic"` is only for standalone scheduling acknowledgements in response to offered slots; explicitly NOT for "Thanks"/"send details"/non-scheduling replies.
- Added/updated unit tests:
  - `lib/__tests__/followup-booking-signal.test.ts` (covers `deriveBookingSignal`)
  - `lib/__tests__/followup-generic-acceptance.test.ts` (fresh/stale offeredAt + `looksLikeTimeProposalText`)
  - Wired into `scripts/test-orchestrator.ts`
- Validation results:
  - `npm test` — pass (2026-02-09)
  - `npm run lint` — pass (warnings only) (2026-02-09)
  - `npm run build` — fail in this sandbox due to Turbopack panic (os error 1: “binding to a port”)
  - `next build --webpack` — pass (2026-02-09)
- Misc hygiene:
  - `.gitignore` now ignores `.DS_Store`
  - Fixed Phase 122 planning-doc mismatch around `selectEarliestSlotForWeekday` existence

## Handoff
Run Phase 122 post-implementation review (`docs/planning/phase-122/review.md`) with evidence mapping to Success Criteria.

## Review Notes
- Follow-up decision (2026-02-09): if Meeting Overseer extraction returns `null`, `processMessageForAutoBooking` now fails closed (no heuristic fallback booking).
