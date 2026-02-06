# Phase 113b — Day-Only Auto-Book (Scenario 3 Extension)

## Focus
When there are **no offered slots** and the lead provides only a day preference (e.g., “Thursday works”), auto-book the **earliest available slot on that day** (then send confirmation), gated by the booking gate when enabled.

## Inputs
- Auto-booking flow:
  - `lib/followup-engine.ts` (`processMessageForAutoBooking`)
- Overseer extraction (preferred day/time):
  - `lib/meeting-overseer.ts` (`preferred_day_of_week`, `preferred_time_of_day`, `relative_preference`)
- Availability cache:
  - `lib/availability-cache.ts` (`getWorkspaceAvailabilitySlotsUtc`)
- Slot formatting:
  - `lib/availability-format.ts` (`formatAvailabilitySlotLabel`)

## Work
1. Detect day-only preference in Scenario 3
   - Prefer overseer extraction when available:
     - `preferred_day_of_week` is set when a weekday is mentioned.
     - treat `acceptance_specificity="day_only"` and/or `preferred_day_of_week` as eligible signals.
   - Fallback deterministic detection only if overseer was not run.

2. Deterministically select the earliest slot on the requested day
   - Define time zone for day matching:
     - `leadTimezone` if present, else workspace timezone, else `UTC`.
   - From `availability.slotsUtc`, pick the earliest UTC slot whose **local weekday** matches the requested day token and is not in the past.
   - If no slot matches: fall back to existing “offer alternatives / create task” behavior.

3. Gate before booking (when enabled)
   - Run booking gate with scenario `day_only` before calling provider booking.
   - Use the same retry/escalation policy defined in 113c.

4. Confirmation
   - After booking succeeds, send confirmation via existing confirmation flow (must include explicit timezone label).

## Validation
- Manual smoke:
  - No offered slots, inbound: “Thursday works”
  - Availability contains Thursday slots
  - System books earliest Thursday slot and sends confirmation

## Output

- Scenario 3 (no offered slots) now supports day-only replies by selecting the earliest available slot on the requested weekday and booking it (gated by `followup.booking.gate.v1` when enabled).
- If day-only booking succeeds, the system sends:
  - Slack notification (auto-booked)
  - post-booking confirmation message with explicit timezone label
- If day-only booking is not possible (no weekday detected or no matching weekday slot), the flow falls back to the existing “offer alternatives via FollowUpTask” path.

## Handoff

Phase 113c should:
- Replace the current immediate `needs_clarification` FollowUpTask behavior with a bounded retry-once loop (same policy across Scenario 1/2 + Scenario 3 day-only/proposed-time).
- Add Slack escalation for “blocked after retry” (no raw message text).
 
## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented Scenario 3 day-only auto-book fallback: detect weekday (overseer token or deterministic regex), pick earliest matching availability slot, gate before booking, and send Slack + confirmation after booking (file: `lib/followup-engine.ts`).
  - Improved suggested follow-up copy when no exact time was proposed (avoid “exact time” wording for day-only / vague proposals) (file: `lib/followup-engine.ts`).
- Commands run:
  - `npm test` — pass
- Blockers:
  - None
- Next concrete steps:
  - Implement the one-retry loop + Slack escalation + tests (Phase 113c).
