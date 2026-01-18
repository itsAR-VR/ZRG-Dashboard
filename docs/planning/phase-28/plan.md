# Phase 28 — Verified Meeting Booking + Completion Tracking

## Purpose
Make “Meeting Booked” (and a new “Meeting Completed”) a verifiable, provider-backed state by reconciling leads against GHL appointments and Calendly bookings, via cron + resumable backfills.

## Context
Today, “Meeting Booked” is often inferred from AI sentiment, which creates false positives (sentiment says booked but no appointment exists) and false negatives (appointment exists but we never recorded it). This leaks into automation: follow-ups can run for “booked” leads because we’re missing provider IDs, and we can’t reliably separate “meeting requested” vs “meeting booked” vs “meeting completed”.

We already store provider IDs on `Lead` (`ghlAppointmentId`, `calendlyInviteeUri`, `calendlyScheduledEventUri`) and a booking timestamp (`appointmentBookedAt`), and we have a Calendly webhook that sets these for invitee events. What’s missing is a robust reconciliation path for:
- GHL appointments created outside ZRG (booked directly in GHL / via calendar link)
- Calendly bookings where we never received/processed the webhook (lookup by lead email)
- Post-meeting completion (attended/occurred) as a first-class state

Even with “we sync all messages”, mismatches still happen in practice (no inbound text confirming booking, missed webhooks, cancellations/reschedules, identity drift like different booking email), so reconciliation + mismatch reporting is a permanent safety net.

Decisions from product:
- **Booked** = any provider appointment exists (not AI-only).
- **Completed**: deferred (requires additional tracking); for now treat “booked” as “completed”.
- Provider evidence overrides AI sentiment; if sentiment says “Meeting Booked” but provider evidence is missing, we downgrade sentiment.

## Objectives
* [ ] Define a meeting lifecycle model (booked/canceled/completed) that is provider-backed and auditable
* [ ] Implement provider reconciliation:
  * [ ] GHL: find appointments for a lead’s `ghlContactId`, store IDs/times/status
  * [ ] Calendly: find bookings by lead `email`, store URIs/times/status
* [ ] Add a cron job that incrementally reconciles leads per workspace in bounded batches
* [ ] Add a resumable backfill runner to repair historical leads at scale
* [ ] Surface discrepancies (sentiment vs provider evidence) and prevent automation drift
* [ ] Detect cancellations/reschedules and surface them as FollowUpTasks (UI “red” indicator)

## Constraints
- Treat all webhooks and inbound payloads as untrusted input: validate and sanitize.
- Reconciliation is read-only with external providers (no creating/updating appointments).
- Backfills must be idempotent, rate-limit aware (especially GHL), and safe for serverless timeouts.
- Never log PII (emails/phones/message bodies); log only IDs and aggregate counts.
- Follow existing patterns: Prisma singleton, cron auth via `CRON_SECRET`, booking/follow-up helpers.

## Success Criteria
- [ ] A lead is considered "booked" when provider evidence exists (GHL appointment or Calendly booking), not AI sentiment alone.
- [ ] Cron reconciliation can run continuously without timeouts and steadily reduces "unknown booking state" leads.
- [ ] A resumable backfill can process historical leads/workspaces and can be re-run safely.
- [x] "Meeting Completed" tracking is explicitly documented as deferred; current system treats a verified booking as "completed" until attendance signals exist.
- [x] Automation respects verified state:
  - [x] No new follow-up enrollment for booked leads (even if sentiment says otherwise)
  - [x] Active follow-up instances are completed/paused when booking is verified
- [ ] Cancellations/reschedules produce visible FollowUpTasks with a "red" indicator for review/re-book flows.
  - Task creation exists: `lib/appointment-cancellation-task.ts` (integrated into reconciliation)
  - Remaining: Follow-ups UI must support these `FollowUpTask.type` values and render the requested "red" indicator (current UI assumes only `email|call|linkedin|sms`)
- [x] A mismatch report exists for operators:
  - [x] Sentiment says booked but no appointment evidence
  - [x] Appointment evidence exists but lead isn't marked booked
  - [x] Canceled appointments still marked "meeting-booked" *(captured as canceled_but_booked_status)*
  - [x] Report includes lead IDs + inbound-reply signals (`lastInboundAt`, `lastMessageDirection`) for quick triage

## Subphase Index
* a — Define meeting lifecycle + schema changes ✅
* b — GHL appointment reconciliation (lookup + mapping) ✅
* c — Calendly booking reconciliation (lookup by lead email) ✅
* d — Cron + resumable backfill runner ✅
* e — Cancellation handling, follow-up gating, and mismatch reporting ✅

---

## Implementation Summary (2026-01-17)

### New Files Created
1. `lib/meeting-lifecycle.ts` - Lifecycle semantics and type-safe helpers
2. `lib/ghl-appointment-reconcile.ts` - GHL appointment reconciliation
3. `lib/calendly-appointment-reconcile.ts` - Calendly booking reconciliation
4. `lib/appointment-reconcile-runner.ts` - Shared batch reconciliation runner
5. `lib/appointment-mismatch-report.ts` - Mismatch detection and reporting
6. `app/api/cron/appointment-reconcile/route.ts` - Cron endpoint
7. `app/api/admin/appointment-mismatches/route.ts` - Admin mismatch report endpoint

### Schema Changes
Added 7 new fields to `Lead` model:
- `appointmentStartAt`, `appointmentEndAt` - Provider-reported times
- `appointmentStatus` - Normalized status (confirmed/canceled/showed/no_show)
- `appointmentCanceledAt` - When cancellation was detected
- `appointmentProvider` - GHL or CALENDLY
- `appointmentSource` - webhook/reconcile_cron/backfill/auto_book/manual
- `appointmentLastCheckedAt` - Reconciliation watermark

### Key Behaviors
- **Provider evidence wins over sentiment** - Mismatches can be auto-corrected
- **Cancellation preserves IDs** - Audit trail maintained
- **Follow-up gating works** - `isMeetingBooked()` uses provider evidence
- **Cron runs every minute** - Up to 500 leads per run (configurable)
- **Cancellation tasks created** - FollowUpTasks with type `meeting-canceled` are created when cancellations are detected

### Deferred Items
1. **Meeting Completed tracking** - No reliable attendance signals yet
2. **Appointment history model** - Full `Appointment` table for reschedule history and audit trail

## Phase Summary

- Shipped:
  - Provider-backed appointment reconciliation (GHL + Calendly) with cron batch runner and mismatch reporting.
  - Lead-level appointment tracking fields + indexes; cron schedule entry in `vercel.json`.
  - Resumable CLI backfill script (`scripts/backfill-appointments.ts`).
  - Cancellation task creation (`lib/appointment-cancellation-task.ts`) integrated into reconciliation.
- Verified:
  - `npm run lint`: pass (warnings) (2026-01-17T13:56:13Z)
  - `npm run build`: pass (2026-01-17T13:56:13Z)
  - `npm run db:push`: pass (2026-01-17T13:56:13Z)
- Notes:
  - Appointment history table (`Appointment` model) not implemented (lead-level rollups only).
  - Cron cadence updated to `* * * * *` (every minute).
  - Cancellation/reschedule tasks are created in DB, but Follow-ups UI still needs safe rendering + the requested "red" indicator styling.
  - See `docs/planning/phase-28/review.md` for evidence mapping and follow-ups.
