# Phase 28b — GHL Appointment Reconciliation (Lookup + Mapping)

## Focus
Reliably detect whether a lead has an appointment in GHL (including those booked outside ZRG) by using `Lead.ghlContactId`, then store appointment IDs/times/status on the lead using the Phase 28a schema.

## Inputs
- Root context: `docs/planning/phase-28/plan.md`
- Schema decision: `docs/planning/phase-28/a/plan.md`
- Existing GHL client: `lib/ghl-api.ts` (currently supports create/update/delete appointment; add read/list as needed)
- GHL contact policy: `lib/ghl-contacts.ts` (sync/backfill should not create contacts implicitly)
- Existing lead fields: `Lead.ghlContactId`, `Lead.ghlAppointmentId`, `Lead.appointmentBookedAt`, `Lead.bookedSlot`

## Work
1. Confirm GHL API lookup strategy:
   - Primary: `GET /contacts/{contactId}/appointments` (fast per-lead, provider-backed).
   - Fallback/augmentation: `GET /calendars/events` (calendar-wide scan within a time window, then map `contactId` → lead).
   - Add `listGHLContactAppointments()` and (optionally) `listGHLCalendarEvents()` helpers to `lib/ghl-api.ts` with rate-limit handling.
2. Define which appointment to treat as “primary” when multiple exist:
   - Prefer the next upcoming appointment; otherwise fall back to the most recently created/updated non-canceled appointment.
   - Record timing + status so downstream “completed” detection can work.
3. Implement reconciliation rules (idempotent):
   - If we find provider appointments → upsert into the new `Appointment` table (provider = GHL), and refresh lead-level rollups (`ghlAppointmentId`, `appointmentBookedAt`, `bookedSlot`, etc) only when they change.
   - If the stored appointment is now canceled → set cancellation fields/status; do not silently delete evidence.
   - If the stored appointment differs from the provider “primary” → decide whether to update or preserve (avoid flapping).
   - If we detect cancellation/reschedule → create a FollowUpTask for review/re-book flows (UI “red” indicator).
4. Apply side effects only when transitioning into a verified-booked state:
   - Complete/stop non-booking follow-up instances that should not run once booked.
   - Start any “post-booking” follow-up sequence that depends on having an appointment.
5. Make it safe at scale:
   - Only run when workspace has `Client.ghlLocationId` + `Client.ghlPrivateKey`.
   - Rate-limit per location and be resilient to 429s/timeouts.
   - Log only lead/client IDs and aggregate counts (no PII).

## Output

### Files Created/Modified

1. **`lib/ghl-api.ts`** - Added two new functions:
   - `getGHLContactAppointments(contactId, privateKey, opts)` - Fetches all appointments for a contact using `GET /contacts/{contactId}/appointments`
   - `getGHLAppointment(eventId, privateKey, opts)` - Fetches a single appointment by ID using `GET /calendars/events/appointments/{eventId}`

2. **`lib/ghl-appointment-reconcile.ts`** - **New file** with reconciliation logic:
   - `reconcileGHLAppointmentForLead(leadId, opts)` - Main reconciliation function for leads with `ghlContactId`
   - `reconcileGHLAppointmentById(leadId, appointmentId, opts)` - Refresh status of an existing appointment
   - `selectPrimaryAppointment(appointments)` - Selects the "primary" appointment (next upcoming or most recent non-canceled)
   - `normalizeGHLAppointmentStatus(ghlStatus)` - Maps GHL statuses to our normalized values

### Primary Appointment Selection Logic

1. Prefer next upcoming non-canceled appointment (start time > now)
2. If none upcoming, prefer most recently scheduled non-canceled appointment
3. If all canceled, return the most recently canceled one (for audit trail)

### GHL Status Mapping

| GHL Status | Normalized Status |
|------------|------------------|
| `cancelled`, `canceled` | `canceled` |
| `confirmed`, `booked` | `confirmed` |
| `showed`, `completed` | `showed` |
| `no_show`, `noshow`, `no-show` | `no_show` |
| Other (e.g., `new`, `pending`) | `confirmed` |

### Reconciliation Side Effects

When transitioning to a verified-booked state (new booking detected):
- Start post-booking follow-up sequence via `autoStartPostBookingSequenceIfEligible()`
- Complete/stop active non-booking follow-up instances (those with `triggerOn != "meeting_selected"`)

When cancellation is detected:
- Set `appointmentStatus = "canceled"` and `appointmentCanceledAt`
- Revert lead status to `"qualified"` if currently `"meeting-booked"`
- Preserve `ghlAppointmentId` for audit trail

### Options for Reconciliation

```typescript
interface GHLReconcileOptions {
  source?: AppointmentSource;    // Default: "reconcile_cron"
  dryRun?: boolean;              // Don't write to database
  skipSideEffects?: boolean;     // Skip follow-up automation
}
```

### Rate Limiting

Uses existing `lib/ghl-api.ts` throttling:
- 90 requests per 10 seconds (configurable via `GHL_REQUESTS_PER_10S`)
- Automatic 429 retry with Retry-After header
- Rate limiting keyed by `locationId`

## Handoff

Proceed to Phase 28c to implement Calendly booking reconciliation. Key similarities to follow:
- Use the same `APPOINTMENT_SOURCE.RECONCILE_CRON` / `BACKFILL` sources
- Follow the same primary appointment selection logic (next upcoming > most recent)
- Apply same side effects on booking transition
- Lookup by lead email instead of contact ID

## Review Notes

- Evidence:
  - Reconcile logic: `lib/ghl-appointment-reconcile.ts`
  - API helpers: `lib/ghl-api.ts`
- Deviations:
  - No `Appointment` table upsert; reconciliation updates lead-level fields.
  - Cancellation/reschedule FollowUpTasks (red indicator) are not implemented.
