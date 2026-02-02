# Phase 80e — Centralize: pauseFollowUpsOnBooking Consolidation

## Focus

Create centralized functions for pausing/completing follow-up sequences when a meeting is booked, and update all call sites to use them.

## Inputs

- Phase 80d complete (auto-send scheduling integrated)
- Current duplicated logic in:
  - `lib/booking.ts:320-338` (GHL booking)
  - `lib/booking.ts:587-605` (Calendly booking)
  - `app/api/webhooks/calendly/[clientId]/route.ts:59-78`
  - `lib/ghl-appointment-reconcile.ts:255-278`

## Work

1. **Add functions to `lib/followup-engine.ts`:**

   ```typescript
   /**
    * Pause or complete follow-up instances when a meeting is booked.
    * Excludes post-booking sequences (triggerOn: "meeting_selected").
    */
   export async function pauseFollowUpsOnBooking(
     leadId: string,
     opts?: { mode?: "complete" | "pause" }
   ): Promise<{ completedCount: number; pausedCount: number }> {
     const mode = opts?.mode ?? "complete";

     const instances = await prisma.followUpInstance.findMany({
       where: {
         leadId,
         status: { in: ["active", "paused"] },
         sequence: { triggerOn: { not: "meeting_selected" } }
       },
       select: { id: true }
     });

     if (instances.length === 0) {
       return { completedCount: 0, pausedCount: 0 };
     }

     const ids = instances.map(i => i.id);

     if (mode === "complete") {
       await prisma.followUpInstance.updateMany({
         where: { id: { in: ids } },
         data: { status: "completed", completedAt: new Date(), nextStepDue: null }
       });
       return { completedCount: ids.length, pausedCount: 0 };
     } else {
       await prisma.followUpInstance.updateMany({
         where: { id: { in: ids } },
         data: { status: "paused", pausedReason: "meeting_booked" }
       });
       return { completedCount: 0, pausedCount: ids.length };
     }
   }

   /**
    * Resume follow-ups if a meeting is canceled.
    */
   export async function resumeFollowUpsOnBookingCanceled(
     leadId: string
   ): Promise<{ resumedCount: number }> {
     const result = await prisma.followUpInstance.updateMany({
       where: {
         leadId,
         status: "paused",
         pausedReason: "meeting_booked"
       },
       data: {
         status: "active",
         pausedReason: null,
         nextStepDue: new Date()
       }
     });

     return { resumedCount: result.count };
   }
   ```

2. **Update call sites:**

   **`lib/booking.ts`** — Replace inline code in `bookMeetingOnGHL()` and `bookMeetingOnCalendly()`:
   ```typescript
   import { pauseFollowUpsOnBooking } from "@/lib/followup-engine";

   // Replace inline prisma.followUpInstance.updateMany with:
   await pauseFollowUpsOnBooking(leadId);
   ```

   **`app/api/webhooks/calendly/[clientId]/route.ts`** — Update `applyPostBookingSideEffects()`:
   ```typescript
   import { pauseFollowUpsOnBooking } from "@/lib/followup-engine";

   // Replace inline code with:
   await pauseFollowUpsOnBooking(leadId);
   ```

   **`lib/ghl-appointment-reconcile.ts`** — Update reconciliation:
   ```typescript
   import { pauseFollowUpsOnBooking } from "@/lib/followup-engine";

   // Replace inline code with:
   await pauseFollowUpsOnBooking(leadId);
   ```

3. **Verify:**
   - `npm run lint`
   - `npm run build`

## Output

- Added `pauseFollowUpsOnBooking()` + `resumeFollowUpsOnBookingCanceled()` in `lib/followup-engine.ts` (default mode = pause with `pausedReason: "meeting_booked"`).
- Replaced inline follow-up completion in `lib/booking.ts`, `lib/ghl-appointment-reconcile.ts`, and `app/api/webhooks/calendly/[clientId]/route.ts`.
- Cancellations now call `resumeFollowUpsOnBookingCanceled()` (Calendly + GHL reconcile).

## Handoff

With backend complete, proceed to Phase 80f to add UI controls for schedule mode.
