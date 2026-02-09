# Phase 122c — Proposed-Time + Day-Only Routing (Date vs Date+Time)

## Focus
Standardize the “date-only vs date+time” routing using the existing agents and Scenario 3 logic:
- If the lead proposes a concrete date+time → parse and attempt match + booking gate.
- If the lead provides a date-only/day-only preference (weekday) → route to the existing weekday/day-only flow + booking gate.
- If the lead is scheduling-related but ambiguous → create clarification tasks (no booking).

## Inputs
- Phase 122a/122b outputs: always-run Meeting Overseer + booking signal + accept-offered routing
- Proposed-time parsing agent: `lib/followup-engine.ts:parseProposedTimesFromMessage` (line 2644)
- Day-only selection (offered-slot threads): `lib/meeting-overseer.ts:selectOfferedSlotByPreference` (line 157) — filters offered slots by weekday + optional time-of-day bracket.
- Day-only selection (no offered slots / Scenario 3 fallback): `lib/followup-engine.ts:selectEarliestSlotForWeekday` — picks the earliest availability slot for a weekday in the lead timezone (optionally respecting `preferred_time_of_day`).
- Booking gate scenarios: `"proposed_time_match"` and `"day_only"` in `lib/followup-engine.ts` (existing)
- Current Scenario 3 logic: lines 3684–3876 in `lib/followup-engine.ts`

## Work
1. Replace heuristic "should parse proposed time" gating (line 3687–3689):
   - Current code already uses overseer when available:
     ```typescript
     const shouldParseProposal = overseerDecision
       ? overseerDecision.is_scheduling_related && overseerDecision.intent === "propose_time"
       : looksLikeTimeProposal;
     ```
   - With always-run overseer (Phase 122a), the fallback path (`looksLikeTimeProposal`) triggers only when overseer returns null (API failure). **This is already correct.** No change needed to the branching logic itself — the change is that overseer is now always-run, making the agent path the primary.
   - **Verify:** when `signal.route === "proposed_time"`, ensure the code enters Scenario 3 correctly.
2. Implement date+time route (proposed-time) — existing code at line 3705 already handles this:
   - Call `parseProposedTimesFromMessage(...)` with lead timezone context (existing).
   - If `needsTimezoneClarification=true`: create the existing timezone clarification task; stop. (line 3716)
   - If parsed times are empty / confidence low: create a clarification task ("What day and time works best?"); stop.
   - If parsed times include concrete UTC starts:
     - match against availability (existing) and run booking gate scenario `"proposed_time_match"` before booking.
   - **No changes needed here** — the existing Scenario 3 code handles this correctly.
3. Implement date-only route in Scenario 3 (no offered slots, lead provides day preference):
   - Currently: when overseer says `intent === "propose_time"` with only a weekday preference and no offered slots, the code calls `parseProposedTimesFromMessage(...)` which tries to extract concrete times.
   - Improvement: if `preferred_day_of_week` is set and `preferred_time_of_day` is null, AND overseer `acceptance_specificity === "day_only"`:
     - Skip `parseProposedTimesFromMessage()` (it would produce low-confidence results for day-only input like "Thursday works")
     - Instead, match the day preference against availability slots directly (reuse availability matching logic)
     - If availability for that day exists, run booking gate scenario `"day_only"` before booking
   - If no availability data for the preferred day: create clarification task ("What time on [day] works best?"); stop.
4. Ensure route outputs are deterministic:
   - "date-only" path must NOT run proposed-time parser (would produce garbage for "Thursday works").
   - "date+time" path must require concrete parsed times, otherwise clarification.
   - When overseer is null: fall back to `looksLikeTimeProposalText()` heuristic + existing code (no regression).

## Validation (RED TEAM)
- Test: "Thursday works" with no offered slots → routes to day-only, NOT proposed-time parser.
- Test: "How about 3pm on Thursday?" with no offered slots → routes to proposed-time parser → concrete UTC time.
- Test: overseer returns null (API failure) + message contains "next week" → falls back to `looksLikeTimeProposalText()` heuristic.
- Verify day-only routing uses `selectEarliestSlotForWeekday` (no offered slots) and `selectOfferedSlotByPreference` (offered slots) as intended.

## Output
- Updated `lib/followup-engine.ts` Scenario 3 gating to route deterministically when `route === "proposed_time" || route === "day_only"`.
- Implemented day-only handling that avoids hallucinated parsing:
  - `route === "day_only"` skips `parseProposedTimesFromMessage(...)` and instead selects availability via `selectEarliestSlotForWeekday(...)`.
  - If no weekday match is possible, creates a clarification task instead of booking.
- Kept date+time flow intact:
  - concrete proposed times still run through `parseProposedTimesFromMessage(...)` → availability match → booking gate (when enabled).

## Handoff
Proceed to Phase 122d: tighten Meeting Overseer extract prompt (registry + fallback), add unit tests for booking-signal routing, and run `npm test`/`npm run lint`/build validation.
