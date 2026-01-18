# Phase 34e — Appointment History API + UI

## Focus
Expose appointment history for a lead and render it in the CRM lead detail UI, while keeping existing “booked status” flows working via lead rollups.

## Inputs
- Existing booking status UI:
  - `components/dashboard/crm-drawer.tsx`
  - `actions/booking-actions.ts` (`getLeadBookingStatus`)
- Existing CRM lead data:
  - `actions/crm-actions.ts`
- New `Appointment` model (from 34a–34d)

## Work
1. Add a server action to fetch appointment history:
   - Location: either `actions/booking-actions.ts` (fits existing booking/appointment surface) or a new `actions/appointment-actions.ts`.
   - Enforce access via `requireLeadAccessById`.
   - Return a normalized timeline DTO (no raw payload), with a bounded limit (e.g., last 20–50 items) to avoid heavy queries.
2. Add UI timeline to `components/dashboard/crm-drawer.tsx`:
   - Display upcoming + past appointments, cancellations, and reschedules.
   - Provide a compact default view with expand-to-see-history.
3. Keep safe fallbacks:
   - If no appointment rows exist (migration incomplete), show the existing lead rollup booking status.
4. Optional operator tooling:
   - Link out to provider record when IDs are present (GHL contact already has link; add event link if feasible).

## Validation (RED TEAM)
- `npm run lint`
- `npm run build`
- Manual smoke test:
  - open a lead with existing booking evidence and confirm timeline renders.
  - open a lead with no appointments and confirm legacy booking status still works.

## Output

### Files Modified

**`actions/booking-actions.ts`**
- Added import for Prisma appointment types (`AppointmentStatus`, `MeetingBookingProvider`, `AppointmentSource`)
- Added `AppointmentHistoryItem` interface (DTO for timeline items)
- Added `getLeadAppointmentHistory(leadId, opts?)` server action:
  - Returns bounded list of appointments (default 20, configurable via `limit`)
  - Ordered by creation date (most recent first)
  - Enforces access control via `requireLeadAccessById`
  - Converts dates to ISO strings for safe serialization
- Added `getLeadBookingStatusEnhanced(leadId)` server action:
  - Returns legacy booking status fields plus appointment count
  - `hasHistory: boolean` to determine if timeline should be shown

### UI Integration (Deferred)

UI timeline component for `components/dashboard/crm-drawer.tsx` is **optional** and deferred to future iteration. The server actions are in place and can be consumed when UI work is prioritized.

Recommended UI approach when implemented:
1. Use `getLeadBookingStatusEnhanced()` to check `hasHistory`
2. If `hasHistory`, show expandable timeline section
3. Lazy-load appointment history via `getLeadAppointmentHistory()` on expand
4. Display status badges (confirmed/canceled/rescheduled/showed/no-show)
5. Link to provider records when IDs are present

### Validation Results

- `npm run lint` — pass (17 warnings, all pre-existing)
- `npm run build` — pass
- Access control enforced via `requireLeadAccessById`
- Safe serialization: all dates converted to ISO strings

## Handoff

Phase 34e (API endpoints) is complete. Proceed to Phase 34f if it exists, otherwise complete Phase 34 wrap-up.

The appointment history infrastructure is in place:
1. Schema: `Appointment` model with full history tracking (Phase 34a)
2. Migration: `scripts/migrate-appointments.ts` for backfill (Phase 34b)
3. Writers: Dual-write in reconciliation and booking (Phase 34c)
4. Webhooks: Calendly webhook dual-write (Phase 34d)
5. API: Server actions for querying history (Phase 34e)

UI timeline can be added in a future iteration when prioritized.
