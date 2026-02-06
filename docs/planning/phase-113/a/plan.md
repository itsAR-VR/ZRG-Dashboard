# Phase 113a — Gate All Booking Scenarios (Scenario-Aware Gate + Scenario 1/2 Wiring)

## Focus
Make the existing booking gate (`followup.booking.gate.v1`) **scenario-aware** and ensure it runs before booking in:
- Scenario 1/2: lead accepts one of the previously offered slots

This subphase should not change provider booking logic; it only adds gating and persistence.

## Inputs
- Auto-booking flow:
  - `lib/followup-engine.ts` (`processMessageForAutoBooking`)
- Booking gate:
  - `followup.booking.gate.v1` prompt in `lib/ai/prompt-registry.ts`
  - `runFollowupBookingGate(...)` in `lib/followup-engine.ts`
- Overseer extraction (structured scheduling intent):
  - `lib/meeting-overseer.ts` (`runMeetingOverseerExtraction`)

## Work
1. Make booking gate scenario-aware (no prompt key bump)
   - Extend the gate prompt instructions to accept a `scenario` field:
     - `accept_offered`
     - `proposed_time_match`
     - `day_only`
   - Update gate rules so timezone ambiguity is handled appropriately:
     - For `accept_offered`: do NOT require lead timezone (slots are already concrete).
     - For `proposed_time_match`: timezone ambiguity can require `needs_clarification` (existing behavior).
     - For `day_only`: allow booking selection based on workspace/lead timezone, but deny if message indicates deferral/non-scheduling.

2. Enrich gate input context (structured, no PII logging)
   - Include:
     - scenario
     - offered slots summary (index, label, UTC ISO)
     - chosen `acceptedSlot` (label + UTC ISO)
     - overseer extraction summary fields (intent, acceptance_specificity, preferred_day_of_week/time_of_day, needs_clarification)
   - Keep: inbound message body as the primary natural-language input (do not include full conversation history).

3. Wire gate into Scenario 1/2 booking path
   - After `acceptedSlot` is resolved but BEFORE `bookMeetingForLead(...)`:
     - run booking gate (when toggles are enabled)
     - persist decision via `MeetingOverseerDecision` upsert (`messageId_stage` with stage `booking_gate`)
   - Gate outcomes:
     - `approve` → proceed booking
     - `deny` → do not book; create FollowUpTask
     - `needs_clarification` → defer to Phase 113c (retry + escalation behavior)

4. Telemetry
   - Ensure `AIInteraction.metadata.bookingGate` includes:
     - `scenario`
     - `decision`, `confidence`, `issuesCount`
   - Keep stats-only, allowlisted keys only.

## Validation
- Manual smoke (local):
  - With `followupBookingGateEnabled=1` and bundle enabled, accept-offered flow triggers a `followup.booking.gate.v1` interaction.
  - Gate decision is persisted with `stage="booking_gate"` (idempotent via `messageId_stage`).

## Output

- `followup.booking.gate.v1` is scenario-aware via prompt rules (no key bump) and richer structured input.
- Scenario 1/2 accept-offered path runs the booking gate (when toggles enabled) before calling `bookMeetingForLead(...)`.
- Gate telemetry includes `scenario` + `retryCount` and persists gate payload via `MeetingOverseerDecision` upsert (`stage="booking_gate"`).

## Handoff

113b implements day-only auto-book selection (earliest slot on requested day). 113c adds the one-retry loop + Slack escalation and upgrades the `needs_clarification` behavior from “task immediately” to “retry once, then task”.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Updated booking gate prompt rules to be scenario-aware (accept_offered / proposed_time_match / day_only) (file: `lib/ai/prompt-registry.ts`).
  - Extended `runFollowupBookingGate(...)` to accept `scenario` + structured context (offered slots, accepted slot, overseer summary) and record stats-only metadata (file: `lib/followup-engine.ts`).
  - Wired booking gate into Scenario 1/2 (accept offered slot) before booking when enabled (file: `lib/followup-engine.ts`).
- Commands run:
  - `npm test` — pass
- Blockers:
  - None
- Next concrete steps:
  - Implement day-only booking selection + gating (Phase 113b).
  - Add retry-on-`needs_clarification` + Slack escalation + regression tests (Phase 113c).
