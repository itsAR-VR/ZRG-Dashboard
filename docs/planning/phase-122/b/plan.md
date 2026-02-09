# Phase 122b — Accept-Offered Routing (Remove Regex Ack; Keep Mechanical Safety Rails + Gate)

## Focus
Use Meeting Overseer extraction as the canonical “did they accept?” signal for offered-slot threads and remove regex-based acknowledgement classification. Keep only mechanical safety rails (not semantic classification), and keep the booking gate as the last-step approval.

## Inputs
- Phase 122a output: booking signal + always-run Meeting Overseer extraction
- Auto-book orchestrator: `lib/followup-engine.ts:processMessageForAutoBooking`
- Meeting Overseer extraction fields:
  - `is_scheduling_related`, `intent`, `acceptance_specificity`, `accepted_slot_index`
  - `preferred_day_of_week`, `preferred_time_of_day`, `needs_clarification`
- Slot selection helper: `lib/meeting-overseer.ts:selectOfferedSlotByPreference`
- Booking gate: `lib/followup-engine.ts:runFollowupBookingGateWithOneRetry`

## Work
1. In the offered-slot scenario (`offeredSlots.length > 0`), replace acceptance detection logic:
   - Use `signal.route === "accept_offered"` (from `deriveBookingSignal`) as the entry condition instead of:
     - `shouldAccept` (line 3337–3342) when overseer is available
   - If overseer extraction returns `null`, fail closed (no booking) per 122a.
2. Replace the current regex-based generic-ack check (lines 3382–3390) with agent-based routing:
	   - Current code:
	     ```typescript
	     if (!acceptedSlot && overseerDecision?.acceptance_specificity === "generic") {
	       if (!isGenericAcceptanceAck(messageTrimmed)) {  // ← regex check
	         return { booked: false };
	       }
	       const slot = offeredSlots[0] ?? null;
	       if (isLowRiskGenericAcceptance({ offeredSlot: slot })) {
	         acceptedSlot = slot;
	       }
	     }
	     ```
	   - New code:
	     ```typescript
	     if (!acceptedSlot && overseerDecision?.acceptance_specificity === "generic") {
	       const slot = offeredSlots.length === 1 ? offeredSlots[0] : null;
	       // Mechanical safety rail: freshness only (7-day window).
	       // Length guard removed — trust Meeting Overseer classification.
	       // Booking gate provides final approval.
	       if (slot && isLowRiskGenericAcceptance({ offeredSlot: slot })) {
	         acceptedSlot = slot;
	       }
	     }
	     ```
   - **Key change:** remove `isGenericAcceptanceAck()` regex gate (agent decides "generic" now). Keep `isLowRiskGenericAcceptance()` with freshness check only (7-day window) as mechanical safety rail. No word-count or length guard — trust overseer classification + booking gate.
   - **Locked decision:** Length guard removed per user decision. The `isLowRiskGenericAcceptance()` function should be simplified to check ONLY slot freshness (remove `isGenericAcceptanceAck()` call and any word/character length checks). The booking gate (`followup.booking.gate.v1`) remains as the final safety net.
3. Preserve specific/day-only selection logic (lines 3357–3380):
   - `accepted_slot_index` (1-based, line 3359): `offeredSlots[overseerDecision.accepted_slot_index - 1]` — already handles 1-based-to-0-based conversion. No change needed.
   - `acceptance_specificity === "specific"` + `parseAcceptedTimeFromMessage()` (line 3366): keep as-is.
   - `selectOfferedSlotByPreference()` (line 3373): keep as-is for weekday/time-of-day preferences.
4. Keep `needs_clarification` behavior:
   - When overseer says `needs_clarification=true`, create the existing clarification task and do not book.
   - This should be checked BEFORE attempting slot resolution.
5. Ensure fail-closed semantics:
   - If no accepted slot can be resolved, create clarification task ("Which of these times works best?"); do not book.
   - Booking gate remains required (when enabled) before booking any accepted slot.

## Validation (RED TEAM)
- Verify `isGenericAcceptanceAck()` regex is no longer called from the acceptance path.
- Verify freshness check still prevents stale-slot booking (> 7 days).
- Test: message "Can you send more details?" with `acceptance_specificity: "generic"` from overseer and fresh slots → should NOT book (overseer should not classify this as "generic" acceptance; if it does, booking gate catches it).
- Test: message "Yes" with fresh offered slots → should book (happy path).
- Test: message "Yes" with stale offered slots (8+ days) → should NOT book.

## Output
- Updated `lib/followup-engine.ts` accept-offered flow to enter via `route === "accept_offered"` (agent-driven routing) instead of regex/heuristic acknowledgement checks.
- Removed regex-based “generic acknowledgement” gating:
  - Deleted/retired `isGenericAcceptanceAck()` usage in the accept path.
  - Simplified `isLowRiskGenericAcceptance(...)` to a mechanical freshness rail only (7-day window on `offeredAt`).
- Hardened generic acceptance auto-booking:
  - Only attempts generic acceptance when exactly 1 offered slot exists (`offeredSlots.length === 1`), then applies freshness.

## Handoff
Proceed to Phase 122c: ensure Scenario 3 routes cleanly between proposed date+time vs day-only (weekday-only) preferences, and that day-only avoids running the proposed-time parser.
