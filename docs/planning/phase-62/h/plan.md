# Phase 62h — Scenario 3: Lead-Proposed Time Auto-Booking (No Offered Slots)

## Focus
Support “lead proposes their own time” by parsing proposed times, intersecting with availability, and direct-booking using the **no-questions** link/calendar (with safe fallbacks when confidence/availability is insufficient).

## Inputs
- Existing helpers:
  - `lib/followup-engine.ts:parseProposedTimesFromMessage()` (currently unused)
  - `lib/timezone-inference.ts:ensureLeadTimezone()`
  - `lib/availability-cache.ts` / availability helpers (for slot lookup)
  - `lib/booking.ts:bookMeetingForLead()` (uses GHL vs Calendly provider)
- Phase 62a/62c/62d dual-link behavior (direct-book event type/calendar available)

## Work
1. **Define trigger conditions (avoid extra AI calls)**
   - Only consider Scenario 3 logic when:
     - auto-booking is enabled (`shouldAutoBook()`), and
     - the inbound message plausibly proposes a time (heuristic gate), and
     - we are not in the “accepted offered slot” path (Scenario 1/2).

2. **Parse proposed times safely**
   - Ensure lead timezone is known (`ensureLeadTimezone()`).
   - Call `parseProposedTimesFromMessage()` with:
     - `nowUtcIso`
     - `leadTimezone`
   - If `needsTimezoneClarification=true`:
     - create a follow-up task asking for timezone / preferred timezone explicitly.

3. **Intersect with availability**
   - Fetch current availability for the workspace (cached; no provider thrash).
   - Find an availability match for one of the proposed start times (exact match or within an acceptable tolerance if needed).
   - If a match exists and confidence is above threshold:
     - book using the **direct-book (no questions)** link/calendar.
   - If no match:
     - create a follow-up task proposing next available times (and/or store offered slots for the lead).

4. **Failure modes**
   - If booking fails:
     - log a clear error key
     - create a follow-up task so the lead doesn’t stall.

## Validation (RED TEAM)
- [ ] Message “How about Tuesday at 10am?” leads to either a booked meeting (when available) or a follow-up task proposing alternatives (when not).
- [ ] No webhook timeout risk: strict timeouts + non-blocking behavior.
- [ ] Unit test for the Scenario 3 trigger gate (prevents running parse/availability on unrelated messages).

## Output
- Scenario 3 is explicitly implemented and testable (or explicitly descoped to “task only” if the user decides).

## Handoff
Re-run Phase 62f’s end-to-end testing checklist with a real Scenario 3 message and confirm behavior matches the user’s intent.

