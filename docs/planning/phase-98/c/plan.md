# Phase 98c — Booking Transition Side Effects (All Paths)

## Focus
Ensure that whenever a lead transitions into "meeting booked", the system completes non-post-booking sequences and starts post-booking sequences when eligible — regardless of which appointment ingestion/reconcile path detected the booking.

## Inputs
- Phase 98b updates (hot reconciliation, GHL contact resolution)
- Existing helpers:
  - `pauseFollowUpsOnBooking(leadId, { mode: "complete" })` — `lib/followup-engine.ts:1736`
  - `autoStartPostBookingSequenceIfEligible({ leadId })` — `lib/followup-automation.ts`
  - `createCancellationTask(...)` — `lib/appointment-cancellation-task.ts`
- Existing code paths with MISSING side effects:
  - `lib/ghl-appointment-reconcile.ts:298` (`reconcileGHLAppointmentById`)
  - `lib/calendly-appointment-reconcile.ts:394` (`reconcileCalendlyBookingByUri`)
  - `actions/crm-actions.ts:589` (`bookMeeting`)
  - `actions/followup-actions.ts:467` (`updateLeadFollowUpStatus`)

## Work

### Step 1: Add side effects to `reconcileGHLAppointmentById()`

File: `lib/ghl-appointment-reconcile.ts`

1. After the `upsertAppointmentWithRollup()` call (around line 384), add transition detection:
   ```ts
   // Detect booking transition
   const wasBooked = lead.appointmentStatus === APPOINTMENT_STATUS.CONFIRMED ||
     (lead.ghlAppointmentId && lead.appointmentStatus !== APPOINTMENT_STATUS.CANCELED);
   const isNewBooking = !wasBooked && !isCanceled;
   const isNewCancellation = wasBooked && isCanceled;
   ```

2. Apply side effects after upsert:
   ```ts
   if (isNewBooking && !opts.skipSideEffects) {
     await autoStartPostBookingSequenceIfEligible({ leadId });
     await pauseFollowUpsOnBooking(leadId, { mode: "complete" });
   }

   if (isNewCancellation && !opts.skipSideEffects) {
     await createCancellationTask({
       leadId,
       taskType: "meeting-canceled",
       appointmentStartTime: startTime,
       provider: "GHL",
     });
   }
   ```

3. Update return value to include `wasTransition: isNewBooking || isNewCancellation`.

### Step 2: Add side effects to `reconcileCalendlyBookingByUri()`

File: `lib/calendly-appointment-reconcile.ts`

1. After the upsert block (around line 477), add transition detection:
   ```ts
   // Detect booking transition
   const wasBooked = lead.appointmentStatus === APPOINTMENT_STATUS.CONFIRMED ||
     (lead.calendlyScheduledEventUri && lead.appointmentStatus !== APPOINTMENT_STATUS.CANCELED);
   const isNewBooking = !wasBooked && !isCanceled;
   const isNewCancellation = wasBooked && isCanceled;
   ```

2. Apply side effects:
   ```ts
   if (isNewBooking && !opts.skipSideEffects) {
     await autoStartPostBookingSequenceIfEligible({ leadId });
     await pauseFollowUpsOnBooking(leadId, { mode: "complete" });
   }

   if (isNewCancellation && !opts.skipSideEffects) {
     await createCancellationTask({
       leadId,
       taskType: "meeting-canceled",
       appointmentStartTime: startTime,
       provider: "CALENDLY",
     });
   }
   ```

3. Update return value to include `wasTransition`.

### Step 3: Fix Calendly reconcile-by-uri "fallback" updates

In `reconcileCalendlyBookingByUri()`, the fallback path (lines 463-477) updates Lead directly when no `calendlyInviteeUri` exists. Ensure this path also:
- Sets `Lead.status = "meeting-booked"` for active events (currently only sets `appointmentStatus`).
- Sets `appointmentBookedAt` if transitioning to booked.

Update the fallback `prisma.lead.update` data:
```ts
{
  calendlyScheduledEventUri: event.uri,
  appointmentStartAt: startTime,
  appointmentEndAt: endTime,
  appointmentStatus: normalizedStatus,
  appointmentSource: source,
  appointmentLastCheckedAt: new Date(),
  appointmentCanceledAt: isCanceled ? new Date() : null,
  // Add these:
  status: isCanceled && lead.status === "meeting-booked" ? "qualified" : (isCanceled ? lead.status : "meeting-booked"),
  appointmentBookedAt: !isCanceled ? (lead.appointmentBookedAt ?? new Date()) : lead.appointmentBookedAt,
}
```

### Step 4: Add side effects to `bookMeeting()` action

File: `actions/crm-actions.ts`

1. Import helpers at top:
   ```ts
   import { pauseFollowUpsOnBooking } from "@/lib/followup-engine";
   ```

2. After the `prisma.lead.update()` call in `bookMeeting()` (around line 597), add:
   ```ts
   await pauseFollowUpsOnBooking(leadId, { mode: "complete" });
   ```

### Step 5: Add side effects to `updateLeadFollowUpStatus()` action

File: `actions/followup-actions.ts`

1. Import helper at top (if not already):
   ```ts
   import { pauseFollowUpsOnBooking } from "@/lib/followup-engine";
   ```

2. After the `prisma.lead.update()` call (around line 494), add:
   ```ts
   // Complete non-post-booking sequences when marked as meeting-booked
   if (outcome === "meeting-booked") {
     await pauseFollowUpsOnBooking(leadId, { mode: "complete" });
   }
   ```

### Step 6: Avoid unintended behavior changes

- Do NOT complete post-booking sequences (`triggerOn="meeting_selected"`).
- Do NOT auto-start post-booking sequences from manual actions (they lack provider evidence).
- Only auto-start post-booking sequences from reconciliation paths where provider evidence exists.

## Output
- Booking-stop side effects applied consistently for:
  - GHL reconciliation by contact (`forLead`) — already done ✓
  - GHL reconciliation by appointment ID (`byId`) — **added in Step 1**
  - Calendly reconciliation by email (`forLead`) — already done ✓
  - Calendly reconciliation by scheduled event URI (`byUri`) — **added in Step 2**
  - Manual UI-driven "Meeting Booked" actions — **added in Steps 4-5**

### Completed
- Added booking transition side effects to:
  - `reconcileGHLAppointmentById()` (post-booking sequence auto-start + complete non-post-booking instances + cancellation task)
  - `reconcileCalendlyBookingByUri()` (same side effects + `wasTransition` return)
- Fixed Calendly by‑URI fallback update to set:
  - `Lead.status = "meeting-booked"` on active events
  - `appointmentBookedAt` on first booking
- Manual actions now complete sequences:
  - `actions/crm-actions.ts:bookMeeting()`
  - `actions/followup-actions.ts:updateLeadFollowUpStatus()` when `outcome="meeting-booked"`

## Coordination Notes
No cross-phase conflicts detected in these files; changes were merged directly.

## Validation (RED TEAM)
- Search for `pauseFollowUpsOnBooking` and verify it is now called in all four gap locations.
- Verify imports are correct in `actions/crm-actions.ts` and `actions/followup-actions.ts`.
- Run `npm run lint` to catch any import errors.
- Run `npm run build` to verify TypeScript compiles.

## Handoff
Proceed to Phase 98d:
- Add followups cron backstop for `Lead.status="meeting-booked"`.
- Add tests for backstop behavior and register them in the test orchestrator.
