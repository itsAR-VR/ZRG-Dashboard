# Phase 34a — Schema Design + Rollup Strategy

## Focus
Define an `Appointment` history model that supports multiple appointments per lead and reschedule/cancellation history, while keeping Phase 28 lead-level rollups working.

## Inputs
- `prisma/schema.prisma` (existing `Lead` rollup fields + `MeetingBookingProvider` enum)
- Phase 28 appointment sources:
  - `lib/meeting-lifecycle.ts`
  - `lib/ghl-appointment-reconcile.ts`
  - `lib/calendly-appointment-reconcile.ts`
  - `lib/booking.ts` (auto-book writes lead fields directly today)
  - `actions/booking-actions.ts` (booking status reads lead fields today)

## Work
1. Finalize `Appointment` schema decisions:
   - Provider identifiers:
     - GHL: `ghlAppointmentId` (idempotency key)
     - Calendly: prefer `calendlyInviteeUri` as idempotency key (scheduled event URI may not be unique across invitees)
   - Status/source typing:
     - Decide whether to introduce Prisma enums (`AppointmentStatus`, `AppointmentSource`) vs reusing strings.
     - Ensure values align with `APPOINTMENT_STATUS` / `APPOINTMENT_SOURCE` in `lib/meeting-lifecycle.ts`.
   - Time fields:
     - Decide whether `startAt`/`endAt` are nullable (Phase 28 rollups are nullable; migration must handle partial data).
   - Reschedule representation:
     - Prefer a single link (`rescheduledFromId`) + reverse relation collection (Prisma-friendly) instead of a symmetric `from/to` pair.
     - Document that reschedule linking is best-effort (provider differences).
   - Audit/debug fields:
     - Avoid storing full raw provider payloads that can contain PII; store a redacted subset or omit entirely.
2. Add the `Appointment` model and `Lead.appointments` relation to `prisma/schema.prisma`.
3. Add indexes for common queries:
   - by `leadId` (timeline)
   - by `status`
   - by `startAt` (sorting/time range queries)
4. Define rollup selection logic (“primary appointment”) as a single deterministic rule shared by:
   - reconciliation
   - webhook updates
   - UI display defaults
   Suggested: next upcoming active → most recent active → most recent canceled (matches Phase 28 logic).

## Validation (RED TEAM)
- `npm run lint`
- `npm run build`
- `npm run db:push` (after schema changes)
- Verify the Prisma schema compiles with self-relations (no relation-name conflicts).
- Verify indexes/uniques won’t block multi-appointment use cases (esp. Calendly group events / multiple invitees).

## Output

### Schema Changes

**New Prisma Enums** (`prisma/schema.prisma`):
- `AppointmentStatus`: CONFIRMED, CANCELED, RESCHEDULED, SHOWED, NO_SHOW
- `AppointmentSource`: WEBHOOK, RECONCILE_CRON, BACKFILL, AUTO_BOOK, MANUAL, MIGRATION

**New `Appointment` Model** (`prisma/schema.prisma:384-425`):
```prisma
model Appointment {
  id                    String    @id @default(uuid())
  leadId                String
  lead                  Lead      @relation(...)

  // Provider identification (unique constraints for idempotency)
  provider                  MeetingBookingProvider
  ghlAppointmentId          String?   @unique
  calendlyInviteeUri        String?   @unique
  calendlyScheduledEventUri String?

  // Timing (nullable for migration of partial data)
  startAt               DateTime?
  endAt                 DateTime?
  timezone              String?

  // Status tracking
  status                AppointmentStatus
  statusChangedAt       DateTime  @default(now())

  // Cancellation/reschedule tracking
  canceledAt            DateTime?
  cancelReason          String?
  rescheduledFromId     String?

  // Source tracking
  source                AppointmentSource

  // Self-referential reschedule chain
  rescheduledFrom       Appointment? @relation("AppointmentReschedule", ...)
  rescheduledTo         Appointment[] @relation("AppointmentReschedule")

  @@index([leadId])
  @@index([leadId, status])
  @@index([startAt])
  @@index([status])
  @@index([provider])
  @@index([createdAt(sort: Desc)])
}
```

**Lead Model Update** (`prisma/schema.prisma:345`):
- Added `appointments Appointment[]` relation

### Rollup Selection Logic

**New File**: `lib/appointment-rollup.ts`

Primary appointment selection rule (deterministic, shared across all writers):
1. Next upcoming CONFIRMED appointment (soonest future `startAt`)
2. Most recent CONFIRMED appointment (latest `startAt`, even if past)
3. Most recent CANCELED appointment (latest `canceledAt` or `createdAt`)

Key functions:
- `selectPrimaryAppointment(appointments, referenceDate)` - Select the primary appointment
- `buildLeadRollupFromAppointment(appointment)` - Build Lead fields from Appointment for backward compat
- `findByProviderKey(appointments, provider, key)` - Find by idempotency key for upserts

### Design Decisions

1. **Idempotency keys**: GHL uses `ghlAppointmentId` (unique), Calendly uses `calendlyInviteeUri` (unique)
2. **No raw payload storage**: Avoided `rawPayload` field to prevent PII concerns
3. **Nullable timing**: `startAt`/`endAt` are nullable to handle migration of partial Phase 28 rollups
4. **Single reschedule link**: `rescheduledFromId` with reverse relation (Prisma-friendly, no symmetric pointer conflicts)
5. **Enums vs strings**: Appointment uses Prisma enums; Lead rollups remain strings for backward compat

### Validation

- `npm run lint` — pass (warnings only, pre-existing)
- `npm run build` — pass
- `npm run db:push` — pass (schema applied to database)

## Handoff

Proceed to Phase 34b: Create the migration script (`scripts/migrate-appointments.ts`) to migrate existing Lead appointment rollup data into the new `Appointment` table.

The migration should:
1. Read leads with appointment data (any of: `ghlAppointmentId`, `calendlyInviteeUri`, `calendlyScheduledEventUri`, `appointmentStartAt`, `appointmentBookedAt`)
2. Create `Appointment` records preserving all existing data
3. Be idempotent (check for existing records by provider key)
4. Support dry-run mode
5. Handle edge cases (canceled, partial data)
6. Use `MIGRATION` as the source

