# Phase 52c — Inbound: Auto-Book from Offered Times + Lead-Proposed Times

## Focus
Extend inbound automation so the system can (2) auto-book from previously offered slots and (3) auto-book when the lead proposes times, while keeping “only auto-book on high confidence” safety rules.

## Inputs
- Phase 52b decision on offered-slot persistence scope.
- Existing auto-booking flow: `lib/followup-engine.ts:processMessageForAutoBooking()`.
- Booking execution: `lib/booking.ts:bookMeetingForLead()` (GHL + Calendly providers).
- Availability sources: `lib/availability-cache.ts` (workspace) and/or provider-specific checks.

## Work
- Process (2): “lead selects one of the times we sent”
  - Ensure the system can reliably detect acceptance even when the message is short (e.g., “Tuesday 3pm works”) and map it to the correct offered slot.
  - Add idempotency safeguards so repeated inbound processing can’t double-book.
- Process (3): “lead proposes times they can do”
  - Define a new parsing+matching flow:
    - Parse candidate datetimes from message text (timezone-aware; ask/hold if timezone is missing).
    - Fetch current workspace availability for the configured booking calendar.
    - Find an intersection slot (exact match or within an allowed tolerance, depending on provider granularity).
    - Auto-book only when parse confidence is high and the selected slot is still available.
  - Define escalation behavior when ambiguous:
    - Create a follow-up task with a suggested clarification message (or ask them to pick from a link).

## Output
- A concrete algorithm spec (and target functions/modules) for “lead-proposed times” auto-booking.
- Updated acceptance criteria for `processMessageForAutoBooking()` so it clearly supports both (2) and (3) without regressions.

## Handoff
Proceed to Phase 52d to handle non-booking inbound cases (call-me + external calendar link) using the same idempotent task/notification patterns.

## Output (Completed)

### Process (2): auto-book from offered times (existing, hardened)

- Kept existing conservative gating: auto-book runs only after:
  - `shouldAutoBook(leadId)` passes (no existing appointment + workspace + lead toggles)
  - `detectMeetingAcceptedIntent()` returns YES
- If `Lead.offeredSlots` exists:
  - `parseAcceptedTimeFromMessage()` maps the message to one of the offered slots.
  - booking executes via `bookMeetingForLead()` and clears offered slots on success (existing booking logic).

### Process (3): lead-proposed time auto-booking (new)

- Extended `lib/followup-engine.ts:processMessageForAutoBooking()`:
  - If no offered-slot match, attempt **lead-proposed time** flow:
    1) ensure a lead timezone exists (uses `lead.timezone`, falls back to `ensureLeadTimezone()`)
    2) parse concrete proposed times via new `parseProposedTimesFromMessage()` (structured JSON prompt)
    3) intersect parsed UTC times with `getWorkspaceAvailabilitySlotsUtc(clientId, { refreshIfStale: true })`
    4) book immediately when a match is found (same booking implementation)
  - If no deterministic match, create a **deduped** follow-up task with a clarification suggestion (never auto-books on ambiguity).

### New primitives

- `lib/followup-engine.ts:parseProposedTimesFromMessage()`:
  - structured JSON prompt via `runStructuredJsonPrompt`
  - prompt key: `followup.parse_proposed_times.v1` (added to `lib/ai/prompt-registry.ts`)
  - returns `{ proposedStartTimesUtc, confidence, needsTimezoneClarification }`
- Follow-up task idempotency:
  - booking-clarification tasks now use `campaignName = "auto_booking_clarification"` and are created only if no pending task exists.

## Handoff
- Proceed to **Phase 52d**:
  - implement Call Requested → call task creation + notification plumbing
  - implement lead calendar-link handling (automation vs escalation) once “schedule it in” semantics are confirmed
