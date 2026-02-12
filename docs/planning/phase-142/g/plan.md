# Phase 142g — Schema + Queue Primitives

## Focus

Implement the architecture pivot: add a booking-only async queue model and supporting schema/types.

## Inputs

- `docs/planning/phase-142/plan.md` (resolved architecture and constraints)
- Existing queue patterns:
  - `lib/background-jobs/runner.ts`
  - `lib/webhook-events/runner.ts`

## Work

1. Update `prisma/schema.prisma`:
- Add `BookingQualificationJob` model with status/locking/retry fields and unique `dedupeKey`.
- Add provider/status enums if needed (`BookingQualificationProvider`, `BookingQualificationJobStatus`).
- Add lead fields:
  - `bookingQualificationStatus`
  - `bookingQualificationCheckedAt`
  - `bookingQualificationReason`
- Add workspace settings fields:
  - `bookingQualificationCheckEnabled`
  - `bookingQualificationCriteria`
  - `bookingDisqualificationMessage`

2. Add queue primitive module:
- `lib/booking-qualification-jobs/enqueue.ts`
- Export:
  - `buildBookingQualificationDedupeKey(...)`
  - `enqueueBookingQualificationJob(...)`

3. Type wiring:
- Regenerate Prisma client via `db:push`.
- Ensure no dependency on `BackgroundJob.messageId` in this new queue path.

## Validation

- `npm run db:push`
- `npm run build`
- `rg -n "BookingQualificationJob|bookingQualificationCheckEnabled|bookingQualificationStatus" prisma/schema.prisma`

## Output

- Implemented:
  - `prisma/schema.prisma`
    - Added enums `BookingQualificationProvider`, `BookingQualificationJobStatus`.
    - Added model `BookingQualificationJob` with dedupe/lock/retry fields and indexes.
    - Added `WorkspaceSettings` fields:
      - `bookingQualificationCheckEnabled`
      - `bookingQualificationCriteria`
      - `bookingDisqualificationMessage`
    - Added `Lead` fields:
      - `bookingQualificationStatus`
      - `bookingQualificationCheckedAt`
      - `bookingQualificationReason`
    - Added `Client.bookingQualificationJobs` and `Lead.bookingQualificationJobs` relations.
  - Added `lib/booking-qualification-jobs/enqueue.ts`:
    - `buildBookingQualificationDedupeKey(...)`
    - `enqueueBookingQualificationJob(...)`
- Validation evidence:
  - `npm run db:push` — pass (schema synced to Supabase project `pzaptpgrcezknnsfytob`).
  - `rg -n "BookingQualificationJob|bookingQualificationCheckEnabled|bookingQualificationStatus" prisma/schema.prisma` — pass.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Completed schema pivot away from `BackgroundJob.messageId` dependency.
  - Added booking-qualification queue primitives with idempotent dedupe handling.
- Commands run:
  - `npm run db:push` — pass, DB schema synced.
  - `rg -n "BookingQualificationJob|bookingQualificationCheckEnabled|bookingQualificationStatus" prisma/schema.prisma` — pass.
- Blockers:
  - None in this subphase.
- Next concrete steps:
  - Wire ingestion points (Calendly webhook + GHL reconcile) to enqueue booking qualification jobs.

## Handoff

- 142h should consume `enqueueBookingQualificationJob(...)` and keep synchronous booking flows non-blocking.
- Use provider anchors for dedupe:
  - Calendly: invitee URI (fallback scheduled event URI)
  - GHL: appointment ID
