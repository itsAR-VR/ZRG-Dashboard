# Phase 114a — Day-Only Auto-Book Expansion (Offered-Slot Threads)

## Focus
When offered slots exist (Scenario 1) and the lead requests a different weekday (e.g., "Thursday works" when offered Tue/Wed), auto-book the earliest available slot on that weekday from **general availability** — filtered by time-of-day when the overseer provides it — **if and only if** the booking gate approves.

This keeps the "booking-first" posture while capturing conversion wins for day-only replies that don't match the originally offered times.

## Inputs
- Auto-book orchestration: `lib/followup-engine.ts` → `processMessageForAutoBooking` (line 3153-3757)
- Meeting overseer extraction: `lib/meeting-overseer.ts` → `preferred_day_of_week` (line 22), `acceptance_specificity` (line 20), `preferred_time_of_day` (line 23)
- Offered-slot preference matcher: `lib/meeting-overseer.ts` → `selectOfferedSlotByPreference` (line 157-192), `normalizeTimeOfDay` (used internally)
- Availability cache: `lib/availability-cache.ts` → `getWorkspaceAvailabilitySlotsUtc` (line 682-730)
- Day-only helper: `lib/followup-engine.ts` → `selectEarliestSlotForWeekday` (line 258-282)
- Booking gate + retry: `lib/followup-engine.ts` → `runFollowupBookingGate` (line 2812, private), `runFollowupBookingGateWithOneRetry` (line 3038, exported)
- Booking target selection: `lib/followup-engine.ts` → `selectBookingTargetForLead`
- Scenario type: `"accept_offered" | "proposed_time_match" | "day_only"` (line 2780)

## Trigger Conditions (exact)
All of these must be true:
1. `offeredSlots.length > 0` (we're in the Scenario 1 branch)
2. `acceptedSlot === null` (no offered slot matched via index, specificity, or preference)
3. `overseerDecision` exists (overseer is enabled for this workspace)
4. `overseerDecision.acceptance_specificity === "day_only"` (lead mentioned a weekday, not an exact time)
5. `overseerDecision.preferred_day_of_week` is set (normalized weekday token like `"thu"`)

## Insertion Point
- **File:** `lib/followup-engine.ts`
- **Location:** Inside the `if (offeredSlots.length > 0)` block (line ~3268), AFTER the `acceptedSlot` resolution chain fails (line ~3326) and BEFORE the existing clarification-task fallback (lines ~3327-3333).
- **Guard:** `if (!acceptedSlot && overseerDecision?.acceptance_specificity === "day_only" && overseerDecision?.preferred_day_of_week)`

## Work
1. **Extend `selectEarliestSlotForWeekday`** to accept optional `preferredTimeOfDay?: string` parameter.
   - When set, first filter candidate slots using the same hour ranges as `selectOfferedSlotByPreference` (morning=5-12h, afternoon=12-17h, evening=17-21h) via the existing `normalizeTimeOfDay` helper (export it from `meeting-overseer.ts` if not already exported).
   - If time-of-day filtering yields no results, **fall back** to weekday-only matching (graceful degradation).
   - Return the earliest matching slot or null.

2. **Add new branch** at the insertion point:
   ```
   if (!acceptedSlot && overseerDecision?.acceptance_specificity === "day_only" && overseerDecision?.preferred_day_of_week) {
     // Lead requested a different weekday than offered — try day-only booking from general availability
   }
   ```

3. **Inside the new branch:**
   - Determine availability source: `selectBookingTargetForLead(...)` → `availabilitySource`
   - Fetch availability: `getWorkspaceAvailabilitySlotsUtc(lead.clientId, { refreshIfStale: true, availabilitySource })`
   - Select slot: `selectEarliestSlotForWeekday({ slotsUtcIso: availability.slotsUtc, weekdayToken: overseerDecision.preferred_day_of_week, timeZone, preferredTimeOfDay: overseerDecision.preferred_time_of_day ?? undefined })`
   - If no slot found → fall through to existing clarification task (no behavior change)
   - If slot found and `bookingGateEnabled`:
     - Gate with `scenario: "day_only"`, retry-once via `runFollowupBookingGateWithOneRetry`
     - Pass `offeredSlots` to gate context (so gate knows what was originally offered)
     - Gate `null` → create clarification task + Slack alert (fail closed)
     - Gate `needs_clarification` after retry → clarification task + Slack alert
     - Gate `deny` → clarification task only (no Slack alert)
     - Gate `approve` → proceed to booking
   - If slot found and gate not enabled → proceed to booking directly
   - Book: `bookMeetingForLead(leadId, slotUtcIso, { availabilitySource })`
   - On success: `sendAutoBookingSlackNotification` + `sendAutoBookingConfirmation` (explicit timezone)
   - Return `{ booked: true, appointmentId }` or `{ booked: false, error }`

4. **Reuse existing helpers** (no new abstractions):
   - `runFollowupBookingGateWithOneRetry`, `runFollowupBookingGate`
   - `bookMeetingForLead`, `sendAutoBookingSlackNotification`, `sendAutoBookingConfirmation`
   - `createClarificationTask`, `sendAutoBookingBlockedSlackAlert`
   - `formatAvailabilitySlotLabel`, `resolveConfirmationChannel`, `getBookingLink`

5. **Gate persistence:** Same `messageId_stage` upsert (idempotent via `MeetingOverseerDecision@@unique([messageId, stage])`)

## Key Files
- `lib/followup-engine.ts` — main edit (~60-90 lines: new branch + `selectEarliestSlotForWeekday` extension)
- `lib/meeting-overseer.ts` — export `normalizeTimeOfDay` if not already exported (minor)
- `lib/availability-cache.ts` — read-only (already imported)

## Validation (RED TEAM)
- Unit test: "offered Tue/Wed, lead says Thursday, availability has Thursday 10am → gate approves → booked Thursday 10am"
- Unit test: "offered Tue/Wed, lead says Thursday, no Thursday availability → falls through to clarification"
- Unit test: "offered Tue/Wed, lead says Tuesday → `selectOfferedSlotByPreference` matches → existing Scenario 1 flow (no change)"
- Unit test: "overseer disabled → no day-only expansion → existing clarification flow"
- Unit test: "lead says 'Thursday morning', has morning + afternoon Thursday slots → picks morning slot"
- Unit test: "lead says 'Thursday morning', only afternoon Thursday slots → falls back to earliest Thursday slot"
- Unit test: `selectEarliestSlotForWeekday` with `preferredTimeOfDay="morning"` filters correctly
- Gate idempotency: same messageId cannot produce duplicate gate decisions

## Progress This Turn (Terminus Maximus)
- Work done:
  - Expanded Scenario 1/2 (offered slots) to attempt weekday-only mapping to an offered slot, and if none match, attempt day-only auto-book from general availability (gate-approved).
  - Extended `selectEarliestSlotForWeekday` with optional `preferredTimeOfDay` filtering (morning/afternoon/evening) with graceful fallback to weekday-only.
  - Made `nowUtcIso` stable across booking-gate retry attempts for the new offered-slot day-only branch.
- Commands run:
  - N/A (code + plan updates only in this turn)
- Blockers:
  - None
- Next concrete steps:
  - 114d: add/extend tests for day-only expansion + time-of-day filtering, then run `npm test`, `npm run lint`, `npm run build`.
  - 114b: implement AI Ops feed backend (last 72h).

## Output
- `lib/followup-engine.ts`: day-only expansion for offered-slot threads + time-of-day filtering support in `selectEarliestSlotForWeekday`.

## Handoff
Proceed to 114b (AI Ops feed backend). Ensure 114b/114c do not introduce raw message text into responses or UI.
