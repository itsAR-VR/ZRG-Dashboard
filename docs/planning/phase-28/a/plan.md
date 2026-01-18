# Phase 28a — Define Meeting Lifecycle + Schema Changes

## Focus
Define a provider-backed meeting lifecycle (booked/canceled/completed) and the database fields we need so reconciliation is deterministic, idempotent, and auditable.

## Inputs
- Root context: `docs/planning/phase-28/plan.md`
- Current model: `prisma/schema.prisma` (`Lead.ghlAppointmentId`, `Lead.calendlyInviteeUri`, `Lead.calendlyScheduledEventUri`, `Lead.appointmentBookedAt`, `Lead.bookedSlot`)
- Existing behavior:
  - Calendly webhook: `app/api/webhooks/calendly/[clientId]/route.ts`
  - Booking: `lib/booking.ts`
  - Follow-up gating: `lib/followup-automation.ts`, `lib/meeting-booking-provider.ts`

## Work
1. Define the states and their meanings:
   - **Booked**: provider evidence exists (GHL appointment ID or Calendly URIs) and the appointment is not canceled.
   - **Canceled**: provider evidence indicates cancellation (or we can no longer find the appointment).
   - **Completed**: deferred until we have reliable attendance tracking; for now treat “booked” as “completed” for automation/product behavior (document this explicitly).
2. Decide how to store appointment metadata:
   - Minimal (Lead-level, single “primary appointment”): extend `Lead` with appointment timing + lifecycle fields.
   - Decision: introduce a new `Appointment` model now (multi-appointment history + reschedules).
   - Keep existing lead-level fields (`ghlAppointmentId`, `calendlyInviteeUri`, `calendlyScheduledEventUri`, `appointmentBookedAt`, `bookedSlot`, `status`) as **rollups** / backwards-compat filters while the system migrates to appointment-first logic.
   - Proposed `Appointment` model (high level):
     - `id`, `clientId`, `leadId`
     - `provider` (`GHL` | `CALENDLY`)
     - Provider identifiers (nullable, unique where applicable):
       - GHL: `ghlAppointmentId`, `ghlContactId`, `ghlCalendarId`, `ghlLocationId`
       - Calendly: `calendlyScheduledEventUri`, `calendlyInviteeUri`, `calendlyEventTypeUri`
     - Timing: `startTime`, `endTime`, `timezone`
     - Lifecycle: `status` (normalized), `canceledAt`, `rescheduledFromAppointmentId` (optional), `raw` JSON (optional, server-only)
     - Source/observability: `source` (`webhook` | `reconcile_cron` | `backfill` | `manual`), `lastSyncedAt`
3. Proposed Lead fields (scoped + minimal):
   - `appointmentStartAt` / `appointmentEndAt` (DateTime?) — provider-reported schedule
   - `appointmentStatus` (String?) — normalized provider status (`confirmed`, `canceled`, `showed`, `no_show`, …)
   - `appointmentCanceledAt` (DateTime?) — when we detected cancellation
   - `appointmentCompletedAt` (DateTime?) — when we marked completion (or provider equivalent)
   - `appointmentLastCheckedAt` (DateTime?) — reconciliation watermark for cron/backfills
   - (Optional) `appointmentProvider` (MeetingBookingProvider?) — what provider evidence was found for this lead (can differ from workspace default)
   - (Optional) `appointmentSource` (String?) — `calendly_webhook` | `reconcile_cron` | `backfill_script` | `manual` | `auto_book`
4. Define invariants for reconciliation updates:
   - When we set `ghlAppointmentId` / Calendly URIs, ensure `appointmentBookedAt` is populated (prefer provider-created-at if available; otherwise “first verified at”).
   - Keep `bookedSlot` aligned with `appointmentStartAt` (or start-time ISO).
   - Cancellation should clear provider IDs only if we are confident (to avoid data loss). Prefer: keep IDs + set `appointmentCanceledAt` + `appointmentStatus="canceled"`, unless existing patterns require clearing.
5. Define authority + resolution rules:
   - Provider evidence can override AI-driven `sentimentTag` (booked/completed take priority over text inference).
   - If sentiment says “Meeting Booked” but provider evidence is missing, downgrade sentiment (exact downgrade target TBD).
6. Decide how “Meeting Completed” appears in the product:
   - Decision (for now): do **not** introduce a separate `Meeting Completed` stage until attendance/no-show signals are implemented; document the gap and treat verified booking as “completed”.
   - Future: add a dedicated completion stage once we can trust provider attendance signals (GHL appointment status / Calendly no_show or manual marking).

## Output

### Schema Changes Applied

Added the following fields to the `Lead` model in `prisma/schema.prisma`:

```prisma
// Reconciliation-focused appointment tracking (Phase 28)
appointmentStartAt        DateTime?                // Provider-reported appointment start time
appointmentEndAt          DateTime?                // Provider-reported appointment end time
appointmentStatus         String?                  // Normalized: confirmed | canceled | rescheduled | showed | no_show
appointmentCanceledAt     DateTime?                // When cancellation was detected
appointmentProvider       MeetingBookingProvider?  // Which provider the appointment came from (GHL | CALENDLY)
appointmentSource         String?                  // How we learned about it: webhook | reconcile_cron | backfill | auto_book | manual
appointmentLastCheckedAt  DateTime?                // Reconciliation watermark for cron/backfills
```

Added indexes for reconciliation queries:
```prisma
@@index([appointmentLastCheckedAt])            // Cron reconciliation cursor
@@index([clientId, appointmentLastCheckedAt])  // Workspace-scoped reconciliation
@@index([appointmentStatus])                   // Filter by appointment state
```

### Lifecycle Semantics (documented in `lib/meeting-lifecycle.ts`)

**States:**
- **Booked**: Provider evidence exists (GHL appointment ID or Calendly URIs) AND `appointmentStatus` is not "canceled"
- **Canceled**: `appointmentStatus = "canceled"` with `appointmentCanceledAt` set; provider IDs preserved for audit
- **Completed**: Deferred until attendance tracking is available; treat verified booking as "completed" for automation

**Appointment Status Values:** `confirmed`, `canceled`, `rescheduled`, `showed`, `no_show`

**Appointment Source Values:** `webhook`, `reconcile_cron`, `backfill`, `auto_book`, `manual`

**Authority Rules:**
- Provider evidence takes priority over AI sentiment
- If sentiment = "Meeting Booked" but no provider evidence → downgrade to "Meeting Requested"
- If provider evidence exists but lead isn't marked booked → update status to "meeting-booked"

**Cancellation Handling:**
- Preserve provider IDs for audit trail (don't clear `ghlAppointmentId` or Calendly URIs)
- Set `appointmentStatus = "canceled"` and `appointmentCanceledAt`
- Revert lead status to "qualified" if it was "meeting-booked"

### Files Modified

1. `prisma/schema.prisma` - Added 7 new Lead fields + 3 indexes
2. `lib/meeting-lifecycle.ts` - **New file** documenting lifecycle semantics with type-safe helpers
3. `lib/meeting-booking-provider.ts` - Updated `isMeetingBooked()` to use Phase 28 lifecycle semantics
4. `lib/followup-automation.ts` - Added `appointmentStatus` to all lead select queries
5. `lib/booking.ts` - Updated GHL and Calendly booking functions to set new appointment tracking fields
6. `app/api/webhooks/calendly/[clientId]/route.ts` - Updated to set new fields on booking and use new cancellation semantics
7. `app/api/cron/insights/booked-summaries/route.ts` - Added `appointmentStatus` to query

### Key Decisions

1. **Deferred Appointment Model**: Kept lead-level rollups instead of introducing a separate `Appointment` table. This can be revisited if multi-appointment history becomes needed.

2. **Cancellation Preserves Evidence**: Provider IDs are not cleared on cancellation, allowing audit trail and preventing data loss.

3. **Backward Compatibility**: The updated `isMeetingBooked()` function falls back to pre-Phase 28 behavior when `appointmentStatus` is not set.

## Handoff

Proceed to Phase 28b to implement GHL appointment lookup + reconciliation. Key inputs:
- Use `Lead.appointmentLastCheckedAt` as the reconciliation watermark
- Set `appointmentProvider = "GHL"` and `appointmentSource = "reconcile_cron"` when discovering appointments
- Use the `buildReconciliationBookedData()` helper from `lib/meeting-lifecycle.ts`
- Respect the lifecycle semantics: only transition to "booked" when provider evidence confirms an active (non-canceled) appointment

## Review Notes

- Evidence:
  - Schema: `prisma/schema.prisma`
  - Lifecycle helpers: `lib/meeting-lifecycle.ts`
  - Build gates: `docs/planning/phase-28/review.md`
- Deviations:
  - `Appointment` history table was not implemented; Phase 28 uses lead-level rollups and reconciliation fields.
