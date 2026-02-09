# Phase 126a — Appointment Attribution (Calendar/Event-Type) + Dedicated Backfill

## Focus
Make bookings attributable to the same calendar/event-type that produced availability, so capacity metrics can be accurate.

## Inputs
- Root intent: `booked_slots / (booked_slots + available_slots)` must be grounded in calendar reality.
- Existing models:
  - `Appointment` stores provider identifiers (GHL appointment id, Calendly invitee uri) but NOT calendar/event-type identifiers.
  - `WorkspaceAvailabilityCache` stores available slots per `availabilitySource` and carries provider meta (e.g. GHL calendar id).
- Existing write helper: `lib/appointment-upsert.ts` — `UpsertAppointmentInput` currently lacks calendar attribution fields.
- All 5 write paths have the calendar ID / event type URI available at call site but do not pass them (see root plan verification table).

## Work

### 1. Prisma schema changes (`prisma/schema.prisma`)

Re-read the current schema before editing (working tree is dirty — Phase 123 may have added models).

- Add nullable calendar attribution fields on `Appointment`:
  - `ghlCalendarId String?`
  - `calendlyEventTypeUri String?`
- Add indexes to support attribution queries AND windowed capacity counts:
  - `@@index([ghlCalendarId])`
  - `@@index([calendlyEventTypeUri])`
  - `@@index([leadId, status, startAt], name: "idx_appointment_capacity_query")` **(RED TEAM H-1: needed for nested `lead: { clientId }` + status + startAt windowed count query in 126b)**
- Run `npm run db:push` and verify columns + indexes exist via Prisma Studio.

### 2. Extend the shared write helper (`lib/appointment-upsert.ts`)

- Add to `UpsertAppointmentInput` interface:
  ```typescript
  ghlCalendarId?: string | null;
  calendlyEventTypeUri?: string | null;
  ```
- Persist both fields into the `appointmentData` object used by `prisma.appointment.upsert()`.
- No changes to `UpsertAppointmentResult` — these are input-only.

### 3. Pass attribution from every appointment write path

Each path already has the value available. The fix is adding one field to the existing `upsertAppointmentWithRollup()` call:

| File | Change |
|---|---|
| `lib/booking.ts` → `bookMeetingOnGHL()` (~line 303) | Add `ghlCalendarId: calendarId` (the `calendarId` variable used for `createGHLAppointment`) |
| `lib/booking.ts` → `bookMeetingOnCalendly()` (~line 551) | Add `calendlyEventTypeUri: selectedEventTypeUri` (resolved earlier in the function ~line 427-501) |
| `app/api/webhooks/calendly/[clientId]/route.ts` (~lines 156, 206) | Add `calendlyEventTypeUri: eventTypeUri` (from `parseInviteePayload()` ~line 111) |
| `lib/ghl-appointment-reconcile.ts` → both functions (~lines 252, 388) | Add `ghlCalendarId: primary.calendarId` (from `GHLAppointment` interface) |
| `lib/calendly-appointment-reconcile.ts` → both functions (~lines 322, 456) | Add `calendlyEventTypeUri: primary.event.event_type ?? null` (from `CalendlyScheduledEvent` interface, field is optional) |

### 4. Dedicated backfill function (RED TEAM C-2 resolution)

**Why not modify reconciliation early-return:** The `needsUpdate` logic in both reconciliation modules checks **Lead rollup fields** (appointment status, `appointmentBookedAt`), not Appointment record fields. Injecting a "missing attribution" check would add a DB read to the hot path of every reconciliation call. Instead, we use a dedicated backfill function.

**Implementation:** Add to `lib/appointment-upsert.ts`:

```typescript
export async function backfillAppointmentAttribution(clientId: string): Promise<{
  ghlUpdated: number;
  calendlyUpdated: number;
  errors: string[];
}>
```

Logic:
- **GHL path:** Query `Appointment WHERE ghlCalendarId IS NULL AND ghlAppointmentId IS NOT NULL AND lead.clientId = clientId`. For each, fetch the appointment from GHL API via `getGHLAppointment(locationId, ghlAppointmentId)` and extract `calendarId`. Update the Appointment row directly (no need for full upsert — just set `ghlCalendarId`).
- **Calendly path:** Query `Appointment WHERE calendlyEventTypeUri IS NULL AND calendlyScheduledEventUri IS NOT NULL AND lead.clientId = clientId`. For each, fetch the scheduled event from Calendly API via `getCalendlyScheduledEvent(scheduledEventUri)` and extract `event_type`. Update the Appointment row.
- **Rate limiting:** Process in batches of 10 with 500ms delay between batches to avoid API rate limits.
- **Error isolation:** Log errors per-appointment but continue processing. Return summary counts.
- **Invocation:** Can be called from an admin endpoint or future cron job. Not called automatically during reconciliation.

### Validation Steps
1. After `npm run db:push`: verify in Prisma Studio that `ghlCalendarId` and `calendlyEventTypeUri` columns exist on `Appointment` table
2. Verify the composite index `idx_appointment_capacity_query` exists
3. Create a test booking via the GHL path → verify `Appointment.ghlCalendarId` is populated
4. Create a test booking via the Calendly webhook → verify `Appointment.calendlyEventTypeUri` is populated
5. Run backfill function on a workspace with historical appointments → verify NULL fields get populated

## Output
- `Appointment` rows carry calendar attribution for all new bookings (immediate).
- Historical appointments can be backfilled via `backfillAppointmentAttribution()` (on-demand, not automatic).

## Handoff
Proceed to Phase 126b to compute capacity metrics using these attribution fields + availability caches.
