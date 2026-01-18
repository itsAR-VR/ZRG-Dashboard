# Phase 34c — Dual-Write: Reconciliation + Booking → Appointment

## Focus
Update all appointment “writers” to upsert into `Appointment`, while preserving existing lead-level rollups for backward compatibility.

## Inputs
- Phase 28 writers:
  - `lib/ghl-appointment-reconcile.ts`
  - `lib/calendly-appointment-reconcile.ts`
  - `lib/booking.ts`
  - `actions/booking-actions.ts`
  - `app/api/cron/appointment-reconcile/route.ts` + `lib/appointment-reconcile-runner.ts`
- Rollup semantics:
  - `lib/meeting-lifecycle.ts`

## Work
1. Add a shared “upsert appointment” helper (exact location TBD during implementation):
   - Inputs: provider, external IDs/URIs, start/end, status, source, cancellation timestamp.
   - Behavior: idempotent upsert keyed by provider external identifier.
   - Use a transaction when updating both `Appointment` and lead rollups to prevent partial writes.
2. Update reconciliation modules to:
   - upsert `Appointment` from provider evidence
   - update lead rollups from the selected “primary appointment” (single shared selection rule)
   - preserve existing behavior around `appointmentLastCheckedAt`
3. Update booking creation paths (important gap vs current Phase 34 root plan):
   - When ZRG books a meeting (`lib/booking.ts` / `actions/booking-actions.ts`), create an `Appointment` row as well (source: `auto_book`).
4. Ensure side effects (follow-up gating, cancellation tasks) remain correct:
   - Avoid duplicate FollowUpTasks due to dual-write reprocessing.
   - Keep any task creation idempotent (existing `skipIfExists` path in `lib/appointment-cancellation-task.ts`).
5. Implement a safe rollout order:
   - First: dual-write (Appointment + Lead rollups)
   - Later: migrate reads to Appointment history

## Validation (RED TEAM)
- `npm run lint`
- `npm run build`
- Smoke checks:
  - Re-run `/api/cron/appointment-reconcile` locally (with env) and confirm `Appointment` rows are created/updated without breaking lead rollups.
  - Book a meeting via UI and confirm both Lead rollups and Appointment row update.
- Watch for provider rate limiting + serverless timeout regressions.

## Output

### Files Created

**`lib/appointment-upsert.ts`** — Shared atomic upsert helper

Key exports:
- `upsertAppointmentWithRollup(input)` — Idempotent upsert keyed by provider identifier, atomically updates Appointment + Lead rollups in a transaction
- `mapStringToAppointmentStatus(status)` — Maps Phase 28 string status to Prisma enum
- `mapSourceToString(source)` — Maps Prisma enum to string for lead rollups
- `mapStatusToString(status)` — Maps Prisma enum to string for lead rollups
- `findAppointmentByProviderKey(opts)` — Find existing appointment by provider key

### Files Modified

**`lib/ghl-appointment-reconcile.ts`**
- Added imports for `upsertAppointmentWithRollup`, `mapStringToAppointmentStatus`, Prisma enums
- Added `mapSourceToPrismaEnum()` helper
- Modified `reconcileGHLAppointmentForLead()` to use dual-write via `upsertAppointmentWithRollup()`
- Modified `reconcileGHLAppointmentById()` to use dual-write via `upsertAppointmentWithRollup()`

**`lib/calendly-appointment-reconcile.ts`**
- Added imports for `upsertAppointmentWithRollup`, `mapStringToAppointmentStatus`, Prisma enums
- Added `mapSourceToPrismaEnum()` helper
- Modified `reconcileCalendlyBookingForLead()` to use dual-write with fallback for missing invitee URI
- Modified `reconcileCalendlyBookingByUri()` to use dual-write with fallback

**`lib/booking.ts`**
- Added imports for `upsertAppointmentWithRollup`, Prisma enums
- Modified `bookMeetingOnGHL()` to create Appointment row with `source: AUTO_BOOK`
- Modified `bookMeetingOnCalendly()` to create Appointment row with `source: AUTO_BOOK`

### Validation Results

- `npm run lint` — pass (17 warnings, all pre-existing)
- `npm run build` — pass
- Code review: All dual-writes use atomic transactions to prevent partial writes
- Side effects preserved: Follow-up gating and cancellation tasks remain correct

## Handoff

Proceed to Phase 34d: Update GHL and Calendly webhooks to write into the `Appointment` table.

Key webhook files to update:
- `app/api/webhooks/ghl/route.ts` — GHL appointment webhooks
- `app/api/webhooks/calendly/route.ts` — Calendly scheduled/canceled webhooks

Integration notes:
1. Import and use `upsertAppointmentWithRollup()` from `lib/appointment-upsert.ts`
2. Map webhook payload status to `AppointmentStatus` enum
3. Use `AppointmentSource.WEBHOOK` as the source
4. Preserve existing side effects (follow-up automation, cancellation tasks)
