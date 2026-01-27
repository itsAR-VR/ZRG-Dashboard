# Phase 60f — Add Compact Prereqs/Requirements Per Process

## Focus
Incorporate compact prerequisites into the reference panel so users understand the key settings/data dependencies that must be in place for each booking process to work as described.

## Inputs
- Root plan: `docs/planning/phase-60/plan.md`
- Source-of-truth behaviors and known limitations: `docs/planning/phase-52/plan.md`
- Auto-book gating logic: `lib/booking.ts:shouldAutoBook()`
- Offered-slot storage: `lib/booking.ts:getOfferedSlots()` / `Lead.offeredSlots`
- Booking provider config surface: `components/dashboard/settings-view.tsx` (Booking tab)
- Template names: `lib/booking-process-templates.ts` (first 5 templates)

## Work

### 1) Define compact prereqs for each process (copy-ready)

Keep this to **one short line** per process, optimized for clarity (not exhaustiveness).

1) **Link + Qualification (No Times)** (Outbound)
   - Prereqs: Calendar link configured (or a booking link available) + qualification questions configured (optional).

2) **Initial Email Times (EmailBison availability_slot)** (Inbound)
   - Prereqs: EmailBison first-touch included offered times (`availability_slot`) so `Lead.offeredSlots` exists + auto-book enabled + booking provider configured.

3) **Lead Proposes Times (Auto-Book When Clear)** (Inbound)
   - Prereqs: Auto-book enabled + booking provider configured + workspace availability configured (for overlap checks).

4) **Call Requested (Create Call Task)** (Inbound)
   - Prereqs: Lead phone captured; notifications require Notification Center rule(s) configured for call-requested alerts.

5) **Lead Provided Calendar Link (Escalate or Schedule)** (Inbound)
   - Prereqs: None to capture link; overlap suggestions require availability configured; booking via the lead’s scheduler is manual-review.

### 2) Wire prereqs into the reference panel UI

- Add a dedicated “Prereqs/Requirements” row (or compact inline line) under each process.
- Ensure prereqs copy is visually scannable (small text, muted, single line; don’t overwhelm the accordion content).
- Prefer explicit “Prereqs:” label to avoid ambiguity vs general “Notes”.

### 3) Validation (drift + correctness)

- Template-name drift check:
  - Confirm the panel’s template labels exactly match `BOOKING_PROCESS_TEMPLATES.slice(0, 5).map(t => t.name)`.
- Behavior sanity check (spot-check in code):
  - Auto-book gating exists (`lib/booking.ts:shouldAutoBook()`).
  - Offered slots exist on lead (`Lead.offeredSlots`) and are required for “accept offered time” flows.
  - Notification Center-dependent language is accurate (call task creation is separate from notifications).

## Output
- Updated reference content and UI spec that includes compact prereqs/requirements per process.

## Handoff
Proceed to implementation with prereqs included, keeping copy concise and consistent with Phase 52 behavior.
