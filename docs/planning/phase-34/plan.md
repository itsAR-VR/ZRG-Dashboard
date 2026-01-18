# Phase 34 — Appointment History Model

## Purpose

Introduce a dedicated `Appointment` table to track full appointment history, reschedules, and cancellations per lead, enabling multi-appointment support and better audit trails.

## Context

Phase 28 implemented provider-backed appointment reconciliation using lead-level rollup fields (`appointmentStartAt`, `appointmentEndAt`, `appointmentStatus`, etc.). This works for the common case of one active appointment per lead but has limitations:

1. **No reschedule history** — When a meeting is rescheduled, we overwrite the previous appointment data. There's no record of "Lead had meeting at 2pm Tuesday, rescheduled to 4pm Wednesday."

2. **No multi-appointment support** — Some leads may have multiple meetings (initial call, follow-up, closing call). Current schema only tracks one.

3. **Limited audit trail** — We preserve `appointmentCanceledAt` but lose details about what was canceled when a new appointment is booked.

4. **Webhook vs reconciliation conflicts** — When webhooks and reconciliation both update lead fields, there's no way to see the sequence of changes.

The `Appointment` model addresses these by storing each booking event as a separate record, with the lead-level fields becoming computed rollups from the most relevant appointment.

## Objectives

* [x] Design and implement `Appointment` model schema (Phase 34a)
* [x] Migrate existing lead appointment data to new table (Phase 34b - script created, ready for production run)
* [x] Update reconciliation modules to write to `Appointment` table (Phase 34c)
* [x] Update webhooks to write to `Appointment` table (Phase 34d - Calendly webhook)
* [x] Add API endpoints for appointment history (Phase 34e)
* [x] Update UI to show appointment history on lead details (Phase 34e - API + CRM drawer timeline shipped)
* [x] Maintain backward compatibility with lead-level rollup fields (atomic dual-write)

## Constraints

- Must be backward compatible — existing lead-level fields continue to work
- Migration must be idempotent and safe to re-run
- No data loss during migration
- Reconciliation and webhooks must remain idempotent
- Performance: appointment history queries should be indexed appropriately
- Never log or store raw provider payloads that contain PII (emails/phones/message bodies). If debugging context is required, store only a minimal redacted subset.

## Non-Goals

- Attendance/“Meeting Completed” truth (still requires provider attendance signals; explicitly out of scope for this phase)
- Replacing lead-level rollups everywhere (we keep them for backward compatibility; read migration can be incremental)

## Schema Design

### New `Appointment` Model

```prisma
// NOTE: This schema is a draft for planning. Final shape is decided in Phase 34a.
// Prefer enums for status/source for type safety, while keeping Lead rollups as strings for backward compat.

enum AppointmentStatus {
  CONFIRMED
  CANCELED
  RESCHEDULED
  SHOWED
  NO_SHOW
}

enum AppointmentSource {
  WEBHOOK
  RECONCILE_CRON
  BACKFILL
  AUTO_BOOK
  MANUAL
  MIGRATION
}

model Appointment {
  id                    String    @id @default(uuid())
  leadId                String
  lead                  Lead      @relation(fields: [leadId], references: [id], onDelete: Cascade)

  // Provider identification
  provider                 MeetingBookingProvider  // GHL or CALENDLY
  ghlAppointmentId         String?   @unique       // GHL appointment ID (idempotency key)
  calendlyInviteeUri       String?   @unique       // Calendly invitee URI (idempotency key)
  calendlyScheduledEventUri String?                // Calendly event URI (may be shared across invitees)

  // Timing (nullable to support migrating Phase 28 partial rollups safely)
  startAt               DateTime?
  endAt                 DateTime?
  timezone              String?   // Original timezone if available

  // Status tracking
  status                AppointmentStatus
  statusChangedAt       DateTime  @default(now())

  // Cancellation/reschedule tracking
  canceledAt            DateTime?
  cancelReason          String?
  rescheduledFromId     String?   // Best-effort link to previous appointment

  // Source tracking
  source                AppointmentSource

  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  // Self-referential relations for reschedule chain (Prisma-friendly)
  rescheduledFrom       Appointment? @relation("AppointmentReschedule", fields: [rescheduledFromId], references: [id])
  rescheduledTo         Appointment[] @relation("AppointmentReschedule")

  @@index([leadId])
  @@index([leadId, status])
  @@index([startAt])
  @@index([status])
}
```

### Lead Model Updates

Keep existing fields as computed rollups:

```prisma
model Lead {
  // ... existing fields ...

  // These become rollups from the primary Appointment
  // Keep for backward compatibility and query performance
  appointmentStartAt        DateTime?
  appointmentEndAt          DateTime?
  appointmentStatus         String?
  appointmentCanceledAt     DateTime?
  appointmentProvider       MeetingBookingProvider?
  appointmentSource         String?
  appointmentLastCheckedAt  DateTime?

  // New relation
  appointments              Appointment[]
}
```

## Repo Reality Check (RED TEAM)

- What exists today:
  - Lead-level rollups in `prisma/schema.prisma` (`appointmentStartAt`, `appointmentEndAt`, `appointmentStatus`, `appointmentProvider`, etc.)
  - Provider reconciliation + cron runner:
    - `lib/ghl-appointment-reconcile.ts`
    - `lib/calendly-appointment-reconcile.ts`
    - `lib/appointment-reconcile-runner.ts`
    - `app/api/cron/appointment-reconcile/route.ts`
  - Calendly webhook that currently writes lead rollups:
    - `app/api/webhooks/calendly/[clientId]/route.ts`
  - Auto-booking that currently writes lead rollups directly:
    - `lib/booking.ts`
    - `actions/booking-actions.ts`
    - `components/dashboard/crm-drawer.tsx`
  - A resumable repair script already exists for Phase 28:
    - `scripts/backfill-appointments.ts`
- What the plan assumes:
  - Appointment history can be added without breaking existing “booked” UI/automation that reads lead rollups.
  - Calendly “appointment” is modeled by invitee URI (not scheduled event URI) to avoid multi-invitee collisions.
- Verified touch points:
  - The file paths above exist in the repo as of 2026-01-17.

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Duplicate Appointment rows (idempotency failure) → choose a deterministic upsert key per provider (GHL appointment ID; Calendly invitee URI) and enforce with DB uniques.
- Lead rollups drift from Appointment history → centralize “primary appointment” selection logic and make all writers update rollups from the same rule.
- Side effects during migration/backfill (FollowUpTasks, sentiment/status) → migration script must explicitly skip side effects and avoid calling automation.
- PII leakage via raw payload storage/logging → do not store raw provider payloads; if debugging metadata is required, store a minimal redacted subset only.
- Prisma self-relation errors → avoid symmetric from/to pointers; use a single `rescheduledFromId` with a reverse relation collection.

### Missing or ambiguous requirements
- Booking creation path is not optional: ZRG auto-booking must dual-write into Appointment history (not just reconciliation/webhooks).
- Reschedule detection is provider-specific and may be unavailable → treat as cancel + new appointment when needed; link chains best-effort.
- Multi-calendar / multiple event types per workspace → pick the same “primary appointment” heuristic used in Phase 28 reconciliation (upcoming active → latest active → latest canceled) and document limitations.

### Testing / validation
- Add explicit rerun-safe checks: migration rerun should not increase row counts; cron/webhooks should not create duplicates.
- Always run: `npm run lint`, `npm run build`, and `npm run db:push` when schema changes.

## Subphase Index

* a — Schema design and migration strategy (`docs/planning/phase-34/a/plan.md`)
* b — Migration script (lead data → Appointment table) (`docs/planning/phase-34/b/plan.md`)
* c — Dual-write: reconciliation + booking → Appointment (`docs/planning/phase-34/c/plan.md`)
* d — Webhooks → Appointment history (`docs/planning/phase-34/d/plan.md`)
* e — API endpoints and UI integration (`docs/planning/phase-34/e/plan.md`)
* f — Follow-ups UI safe render + red cancellation tasks (`docs/planning/phase-34/f/plan.md`)

---

## Subphase Details

### Phase 34a — Schema Design and Migration Strategy

**Focus**: Finalize schema, create Prisma migration, plan data migration approach.

**Work**:
1. Add `Appointment` model to `prisma/schema.prisma`
2. Add relation from `Lead` to `Appointment`
3. Create migration with `npm run db:push` or generate migration file
4. Document rollup computation logic (which appointment is "primary")

**Output**: Schema changes applied, migration strategy documented.

---

### Phase 34b — Data Migration Script

**Focus**: Migrate existing lead appointment data to the new `Appointment` table.

**Work**:
1. Create `scripts/migrate-appointments.ts`
2. For each lead with appointment data:
   - Create an `Appointment` record from lead-level fields
   - Preserve all existing data (no loss)
3. Make migration idempotent (check for existing records)
4. Support dry-run mode
5. Handle edge cases:
   - Leads with canceled appointments
   - Leads with incomplete data (e.g., missing times)

**Output**: `scripts/migrate-appointments.ts` that can be run safely multiple times.

---

### Phase 34c — Update Reconciliation Modules

**Focus**: Modify GHL and Calendly reconciliation to write to `Appointment` table.

**Work**:
1. Update `lib/ghl-appointment-reconcile.ts`:
   - Create/update `Appointment` record instead of just lead fields
   - Detect reschedules (different appointment ID for same lead)
   - Link reschedule chain best-effort via `rescheduledFromId` (reverse relation provides “to”)
   - Update lead rollup fields after Appointment write

2. Update `lib/calendly-appointment-reconcile.ts`:
   - Same pattern as GHL
   - Prefer `calendlyInviteeUri` as the idempotency key (scheduled event URI can be shared across invitees)

3. Update `lib/appointment-reconcile-runner.ts` if needed

4. Update auto-booking writes to create Appointment history as well:
   - `lib/booking.ts`
   - `actions/booking-actions.ts`

**Output**: Reconciliation writes to both `Appointment` and `Lead` (for backward compat).

---

### Phase 34d — Update Webhooks

**Focus**: Modify webhook handlers to write to `Appointment` table.

**Work**:
1. Update `app/api/webhooks/calendly/[clientId]/route.ts`:
   - Create `Appointment` record on `invitee.created`
   - Update `Appointment` record on `invitee.canceled`
   - Update lead rollup fields

2. Future: Add GHL appointment webhooks if available

**Output**: Webhooks write to `Appointment` table with full history.

---

### Phase 34e — API Endpoints and UI Integration

**Focus**: Expose appointment history via API and show in UI.

**Work**:
1. Add server action: `getLeadAppointmentHistory(leadId)` (location TBD; likely `actions/booking-actions.ts`)
2. Update CRM drawer (`components/dashboard/crm-drawer.tsx`) to show appointment history timeline (with a safe fallback to lead rollups if empty)
3. Show reschedule chains visually
4. Add filters: show canceled, show all vs active only

**Output**: Appointment history API exists; CRM drawer UI renders a basic appointment timeline.

---

## Success Criteria

- [x] `Appointment` model exists and is indexed appropriately
- [x] Existing lead appointment data is migrated without loss (migration executed via `npm run migrate:appointments -- --apply`)
- [x] Migration script is rerun-safe (idempotent; does not create duplicates) *(local `tsx` runner via `npm run migrate:appointments`; no `npx` required)*
- [x] Reconciliation creates `Appointment` records and maintains lead rollups *(implementation present; not replay-tested in this review)*
- [x] Webhooks create `Appointment` records and maintain lead rollups (Calendly webhook) *(implementation present; not replay-tested in this review)*
- [x] Auto-booking creates `Appointment` records and maintains lead rollups *(implementation present; not replay-tested in this review)*
- [x] Reschedule chains are tracked best-effort via `rescheduledFromId` links (reverse relation provides "to") *(best-effort Calendly linking in `upsertAppointmentWithRollup()`)*
- [x] API endpoint returns appointment history for a lead (`getLeadAppointmentHistory`)
- [x] UI shows appointment history timeline (CRM drawer integration)
- [x] Follow-ups UI safely renders cancellation/reschedule tasks with a visible “red” indicator
- [x] All existing functionality continues to work (backward compatible) *(build passes; runtime flows not re-tested here)*
- [x] No raw provider payloads with PII are stored *(logging not exhaustively audited)*

## Risks

1. **Migration complexity** — Leads may have incomplete or inconsistent appointment data
   - Mitigation: Handle edge cases gracefully, log warnings, don't fail on bad data

2. **Dual-write overhead** — Writing to both `Appointment` and `Lead` adds latency
   - Mitigation: Use transactions, consider async rollup updates if needed

3. **Reschedule detection** — Distinguishing "new appointment" from "reschedule" is heuristic
   - Mitigation: Use time proximity + same lead as indicators, allow manual linking

## Dependencies

- Phase 28 (completed) — Lead-level appointment fields exist
- Prisma schema access
- UI component access for CRM drawer

## Estimated Scope

- Schema + migration: Small
- Reconciliation updates: Medium
- Webhook updates: Small
- API + UI: Medium

Total: Medium-sized phase, can be broken into subphases for incremental delivery.

---

## Completion Summary (2026-01-18)

Phase 34 implementation shipped the Appointment history schema + dual-write infrastructure, plus a basic CRM drawer appointment history timeline; see `docs/planning/phase-34/review.md`.

### Phase 34a — Schema Design + Rollup Strategy
- Added `AppointmentStatus` and `AppointmentSource` enums to Prisma schema
- Added `Appointment` model with provider identification, timing, status tracking, and reschedule chain
- Added `appointments` relation to Lead model
- Created `lib/appointment-rollup.ts` with `selectPrimaryAppointment()` and `buildLeadRollupFromAppointment()`

### Phase 34b — Migration Script
- Created `scripts/migrate-appointments.ts` (idempotent, resumable)
- Supports --dry-run, --apply, --clientId, --max-leads, --resume, --state-file
- Uses `AppointmentSource.MIGRATION` for backfilled records

### Phase 34c — Dual-Write: Reconciliation + Booking
- Created `lib/appointment-upsert.ts` with atomic `upsertAppointmentWithRollup()`
- Updated `lib/ghl-appointment-reconcile.ts` for dual-write
- Updated `lib/calendly-appointment-reconcile.ts` for dual-write
- Updated `lib/booking.ts` to create Appointment rows on auto-book

### Phase 34d — Webhooks
- Updated `app/api/webhooks/calendly/[clientId]/route.ts` for dual-write
- Handles both `invitee.created` and `invitee.canceled` events
- Creates cancellation tasks for follow-up visibility

### Phase 34e — API Endpoints
- Added `getLeadAppointmentHistory()` server action in `actions/booking-actions.ts`
- Added `getLeadBookingStatusEnhanced()` for UI consumption
- CRM drawer appointment history timeline wired in `components/dashboard/crm-drawer.tsx`

### Phase 34f — Follow-ups UI Robustness
- Added `FollowUpTaskType` with `meeting-canceled` and `meeting-rescheduled`
- Updated Follow-ups view with icons/colors for new task types
- Added "red" styling for urgent cancellation/reschedule tasks
- Defensive fallbacks for unknown task types

### Key Files Created/Modified
- `prisma/schema.prisma` — Appointment model and enums
- `lib/appointment-rollup.ts` — Primary appointment selection
- `lib/appointment-upsert.ts` — Atomic dual-write helper
- `scripts/migrate-appointments.ts` — Backfill script
- `lib/ghl-appointment-reconcile.ts` — GHL reconciliation dual-write
- `lib/calendly-appointment-reconcile.ts` — Calendly reconciliation dual-write
- `lib/booking.ts` — Auto-booking dual-write
- `app/api/webhooks/calendly/[clientId]/route.ts` — Webhook dual-write
- `actions/booking-actions.ts` — Appointment history API
- `actions/followup-actions.ts` — Task type expansion
- `components/dashboard/follow-ups-view.tsx` — UI robustness

### Validation
- `npm run lint` — pass (17 warnings) (2026-01-18T09:58:57+03:00)
- `npm run build` — pass (2026-01-18T10:00:15+03:00)
- `npm run db:push` — pass (database already in sync)
- `npm run migrate:appointments -- --apply` — executed (Lead rollups → `Appointment`)
