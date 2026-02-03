# Phase 98a — Baseline + Stop Semantics Audit

## Focus
Lock down the exact "stop" behavior and identify every code path that can mark a lead as booked so we know where to enforce the booking-stop side effects.

## Inputs
- Jam: `https://jam.dev/c/aaf7e47d-a3d9-4053-b578-a27e8cafc26c`
- Existing booking semantics:
  - `pauseFollowUpsOnBooking()` in `lib/followup-engine.ts:1736`
  - Booking evidence semantics in `lib/meeting-booking-provider.ts` + `lib/meeting-lifecycle.ts`
- Existing appointment ingestion/reconcile:
  - `app/api/webhooks/calendly/[clientId]/route.ts`
  - `lib/ghl-appointment-reconcile.ts`, `lib/calendly-appointment-reconcile.ts`
  - `lib/appointment-reconcile-runner.ts`, `app/api/cron/appointment-reconcile/route.ts`

## Work
1. Enumerate and confirm the "booking state write" paths (mark lead booked):
   - Calendly webhook (`invitee.created`) — `app/api/webhooks/calendly/[clientId]/route.ts`
   - Auto-booking (`lib/booking.ts:bookMeetingOnGHL`, `lib/booking.ts:bookMeetingOnCalendly`)
   - Appointment reconciliation (cron) — four functions:
     - `reconcileGHLAppointmentForLead()` — ✓ has side effects
     - `reconcileGHLAppointmentById()` — ✗ NO side effects (gap)
     - `reconcileCalendlyBookingForLead()` — ✓ has side effects
     - `reconcileCalendlyBookingByUri()` — ✗ NO side effects (gap)
   - Manual UI actions:
     - `actions/crm-actions.ts:bookMeeting()` — ✗ NO side effects (gap)
     - `actions/followup-actions.ts:updateLeadFollowUpStatus()` with `outcome="meeting-booked"` — ✗ NO side effects (gap)
     - `actions/booking-actions.ts:bookMeetingForLead()` — ✓ has side effects

2. Enumerate current "stop sequences" behavior:
   - `pauseFollowUpsOnBooking(leadId, { mode: "complete" })` completes all instances where `sequence.triggerOn != "meeting_selected"`.
   - Confirm where called:
     - `lib/booking.ts:321` (GHL auto-book) ✓
     - `lib/booking.ts:570` (Calendly auto-book) ✓
     - `lib/ghl-appointment-reconcile.ts:260` (forLead) ✓
     - `lib/calendly-appointment-reconcile.ts:358` (forLead) ✓
     - `actions/booking-actions.ts:492` ✓
   - Confirm where MISSING:
     - `lib/ghl-appointment-reconcile.ts:298` (byId) — NOT CALLED
     - `lib/calendly-appointment-reconcile.ts:394` (byUri) — NOT CALLED
     - `actions/crm-actions.ts:589` (bookMeeting) — NOT CALLED
     - `actions/followup-actions.ts:467` (updateLeadFollowUpStatus) — NOT CALLED

3. Confirm desired invariants:
   - Meeting booked must prevent non-post-booking sequences from sending (complete within ~1 minute).
   - Post-booking sequences remain allowed and may auto-start when provider evidence exists.

4. Define "hot lead" selection criteria for reconciliation (agreed direction):
   - Lead has an active follow-up instance with `sequence.triggerOn != "meeting_selected"`.
   - Check `appointmentLastCheckedAt IS NULL` OR `< hotCutoff` (1 minute).

## Output
- A definitive list of "booking write paths" and "side-effect enforcement points" to be updated in later subphases:
  - **98b**: Hot-lead reconciliation runner changes
  - **98c**: Add side effects to `reconcileGHLAppointmentById()`, `reconcileCalendlyBookingByUri()`, `bookMeeting()`, `updateLeadFollowUpStatus()`
  - **98d**: Add cron backstop
- A concrete, implementable definition of hot-lead eligibility and the 1-minute SLA mechanism (env var + limits).

## Validation (RED TEAM)
- Confirm the four gap locations by searching for `pauseFollowUpsOnBooking` and verifying it is NOT called in:
  - `reconcileGHLAppointmentById()`
  - `reconcileCalendlyBookingByUri()`
  - `bookMeeting()`
  - `updateLeadFollowUpStatus()`

## Handoff
Proceed to Phase 98b to implement hot-lead reconciliation changes and GHL contact resolution improvements.
