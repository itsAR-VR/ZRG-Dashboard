# Phase 34b — Lead Rollup → Appointment Migration Script

## Focus
Backfill an initial `Appointment` row per lead from existing Phase 28 lead-level rollup fields, without triggering side effects (follow-ups, sentiment changes, etc.).

## Inputs
- `prisma/schema.prisma` (new `Appointment` model, existing `Lead.*appointment*` fields)
- Existing CLI patterns in `scripts/` (e.g. `scripts/backfill-appointments.ts`)
- Side-effect toggles already used in Phase 28:
  - `scripts/backfill-appointments.ts --skip-side-effects`

## Work
1. Create `scripts/migrate-appointments.ts` (idempotent):
   - Dry-run default; `--apply` to write.
   - Optional `--clientId`, `--max-leads`, `--resume --state-file`.
2. For each lead with provider evidence (`ghlAppointmentId` OR `calendlyInviteeUri` OR `calendlyScheduledEventUri`):
   - Create (or upsert) an `Appointment` row using a deterministic unique key:
     - Prefer `ghlAppointmentId` for GHL.
     - Prefer `calendlyInviteeUri` for Calendly.
   - Copy over:
     - `appointmentStartAt`, `appointmentEndAt`, `appointmentStatus`, `appointmentCanceledAt`, `appointmentProvider`, `appointmentSource`
     - Provider URIs/IDs on lead (`ghlAppointmentId`, `calendlyInviteeUri`, `calendlyScheduledEventUri`)
   - If timing fields are missing, still migrate what we can (depends on schema nullability decision in 34a).
     - If `appointmentStartAt` is null but `bookedSlot` looks like an ISO timestamp, use it as a fallback for `startAt`.
3. Do NOT:
   - create FollowUpTasks
   - change `Lead.status`
   - change `Lead.sentimentTag`
4. After inserting appointments:
   - Optionally recompute lead rollups from Appointment data in the same script (behind a flag), or explicitly defer to 34c when dual-write is live.
5. Log only IDs + counts (no PII).

## Validation (RED TEAM)
- Run on a small sample first:
  - `npx tsx scripts/migrate-appointments.ts --dry-run --max-leads 50`
  - `npx tsx scripts/migrate-appointments.ts --apply --max-leads 50`
- Verify idempotency:
  - rerun `--apply` and confirm counts do not grow unexpectedly.
- Sanity check counts:
  - `Appointment` rows should be ~equal to “leads with provider evidence” (allowing for skipped partial rows depending on schema).
- Verify no side effects:
  - no new FollowUpTasks are created by migration runs.

## Output

### Files Created

**`scripts/migrate-appointments.ts`** — Idempotent migration script

Usage:
```bash
# Dry run (preview changes)
npx tsx scripts/migrate-appointments.ts --dry-run

# Apply changes
npx tsx scripts/migrate-appointments.ts --apply

# Target specific workspace
npx tsx scripts/migrate-appointments.ts --apply --clientId <workspaceId>

# Resume from previous state
npx tsx scripts/migrate-appointments.ts --apply --resume --state-file ./.migrate-appointments.state.json

# Limit number of leads
npx tsx scripts/migrate-appointments.ts --apply --max-leads 100
```

### Key Implementation Details

1. **Idempotency**: Checks for existing `Appointment` by provider key (`ghlAppointmentId` or `calendlyInviteeUri`) before creating
2. **No side effects**: Does NOT create FollowUpTasks, change Lead.status, or change Lead.sentimentTag
3. **Source tracking**: All migrated appointments use `AppointmentSource.MIGRATION`
4. **Status mapping**: Maps Phase 28 string status to Prisma `AppointmentStatus` enum
5. **Fallback logic**: Uses `bookedSlot` as fallback for `startAt` if `appointmentStartAt` is null
6. **Resumable state**: Supports `--resume --state-file` for large migrations

### Migration Logic

For each lead with provider evidence (`ghlAppointmentId` OR `calendlyInviteeUri` OR `calendlyScheduledEventUri`):
1. Determine provider (GHL vs Calendly) from existing IDs
2. Check if `Appointment` already exists by idempotency key
3. Map status: string → `AppointmentStatus` enum (default: CONFIRMED)
4. Create `Appointment` row preserving all rollup data

### Validation Results

- `npm run lint` — pass (warnings only, pre-existing)
- Dry-run test: Found 1 lead with appointment data across 61 clients
- Script compiles and runs successfully

## Handoff

Proceed to Phase 34c: Update reconciliation modules (`lib/ghl-appointment-reconcile.ts`, `lib/calendly-appointment-reconcile.ts`) and auto-booking writes (`lib/booking.ts`) to dual-write into the `Appointment` table while maintaining lead rollups for backward compatibility.

Key integration points:
1. Use `findByProviderKey()` from `lib/appointment-rollup.ts` for upserts
2. Use `selectPrimaryAppointment()` + `buildLeadRollupFromAppointment()` for lead updates
3. Ensure idempotency via unique constraints on provider keys
