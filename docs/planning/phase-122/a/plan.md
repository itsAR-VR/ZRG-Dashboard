# Phase 122a — Booking Signal Contract + Always-Run Meeting Overseer

## Focus
Introduce a canonical, testable “booking signal” derived from **Meeting Overseer extraction** (and existing parse outputs) and run Meeting Overseer extraction **whenever auto-booking is enabled**.

This subphase is about producing a single, deterministic object that the rest of `processMessageForAutoBooking(...)` can route on, without regex-based acknowledgement classification.

## Inputs
- Root context: `docs/planning/phase-122/plan.md`
- Auto-book orchestrator: `lib/followup-engine.ts:processMessageForAutoBooking`
- Meeting Overseer extraction: `lib/meeting-overseer.ts:runMeetingOverseerExtraction`
- Existing scenario helpers/parsers:
  - `lib/followup-engine.ts:parseAcceptedTimeFromMessage`
  - `lib/followup-engine.ts:parseProposedTimesFromMessage`
  - `lib/meeting-overseer.ts:selectOfferedSlotByPreference`

## Work
1. Define an internal `BookingSignal` type and a pure **route-selection** helper (for unit tests) inside `lib/followup-engine.ts`:
   ```typescript
   type BookingRoute = "accept_offered" | "day_only" | "proposed_time" | "none";
   type BookingSignal = {
     wantsToBook: boolean;
     route: BookingRoute;
     preferredDayOfWeek: string | null;
     preferredTimeOfDay: string | null;
   };
   export function deriveBookingSignal(opts: {
     overseerDecision: MeetingOverseerExtractDecision | null;
     hasOfferedSlots: boolean;
   }): BookingSignal
   ```
   - This is a **pure route selector** only — it does NOT create tasks, call the gate, or do any I/O.
   - `wantsToBook` logic:
     - If overseer is null → `{ wantsToBook: false, route: "none" }`
     - If `!is_scheduling_related` → `{ wantsToBook: false, route: "none" }`
     - If `intent === "decline" || intent === "other"` → `{ wantsToBook: false, route: "none" }`
     - If `intent === "accept_offer" && hasOfferedSlots` → `{ wantsToBook: true, route: "accept_offered" }`
     - If `intent === "propose_time"` → `{ wantsToBook: true, route: "proposed_time" }`
     - If `intent === "request_times"` → route `"none"` (lead is asking for times, not providing them)
     - If `intent === "reschedule"` → route `"none"` (lead wants to change an existing meeting, not book new — see RED TEAM note)
   - Carry through `preferredDayOfWeek` and `preferredTimeOfDay` from overseer for downstream routing.
2. Update `processMessageForAutoBooking(...)` to run Meeting Overseer extraction **always** when auto-booking is enabled:
   - At line 3289–3303, replace the conditional:
     ```typescript
     // BEFORE (Phase 121):
     const shouldOversee = shouldRunMeetingOverseer({ ... });
     const overseerDecision = shouldOversee ? await runMeetingOverseerExtraction({ ... }) : null;

     // AFTER (Phase 122):
     const overseerDecision = await runMeetingOverseerExtraction({
       clientId: lead.clientId,
       leadId: lead.id,
       messageId: meta?.messageId,
       messageText: messageTrimmed,
       offeredSlots,
     });
     ```
   - **Do NOT remove `shouldRunMeetingOverseer()` from `lib/meeting-overseer.ts`** — it may be called by other callers (grep to confirm during implementation). Only bypass it at this call site.
   - Keep idempotency: `messageId` already passed to caching via `MeetingOverseerDecision` table.
   - If extraction returns `null` (API failure, timeout): **fail closed** (return `{ booked: false }`). Do not attempt any heuristic routing or booking.
3. Wire `deriveBookingSignal(...)` into the main function flow:
   - After overseer extraction, call: `const signal = deriveBookingSignal({ overseerDecision, hasOfferedSlots: offeredSlots.length > 0 })`
   - Use `signal.route` to branch into Scenario 1/2 (accept_offered), Scenario day-only, or Scenario 3 (proposed_time).

## Validation (RED TEAM)
- Verify `shouldRunMeetingOverseer` is still exported and used elsewhere (grep before removing gating).
- Verify `deriveBookingSignal` produces `{ wantsToBook: false, route: "none" }` for `intent: "decline"` and `intent: "other"`.
- Verify `reschedule` intent does NOT route to booking (unless user overrides this decision).

## Output
- Implemented booking-signal contract in `lib/followup-engine.ts`:
  - `BookingRoute` + `BookingSignal`
  - `deriveBookingSignal({ overseerDecision, hasOfferedSlots })` (pure route selector; fail-closed)
- Updated `lib/followup-engine.ts:processMessageForAutoBooking()` to always run `runMeetingOverseerExtraction(...)` (cached by `messageId`) and route using `signal.route`.
- Preserved `shouldRunMeetingOverseer()` export in `lib/meeting-overseer.ts` (only bypassed at the auto-book call site).

## Handoff
Proceed to Phase 122b: update offered-slot acceptance routing so generic acceptance is overseer-driven (no regex ack) and constrained by mechanical safety rails + booking gate.
