# Phase 80h — Hardening: Booking Follow-Up Pause Call-Site Audit

## Focus

Ensure “meeting booked” consistently pauses/completes follow-up instances across *every* booking path, not just the first three call sites identified in Phase 80e.

This subphase exists because follow-up completion-on-booking logic is duplicated in multiple places, and missing even one results in inconsistent behavior.

## Inputs

- Phase 80e complete (central helper functions exist in `lib/followup-engine.ts`)
- Known booking call sites to audit/update:
  - `lib/booking.ts`
  - `actions/booking-actions.ts`
  - `app/api/webhooks/calendly/[clientId]/route.ts`
  - `lib/ghl-appointment-reconcile.ts`
  - `lib/calendly-appointment-reconcile.ts`

## Work

1. **Confirm booking semantics (RED TEAM):**
   - Decide whether follow-ups should be **completed** or **paused** on booking.
   - Decide whether cancellations/reschedules should **resume** previously-paused instances.

2. **Enumerate all call sites:**
   - Search for the follow-up completion pattern (triggerOn != `meeting_selected`) and any direct `followUpInstance.updateMany(...)` calls used as post-booking side effects.
   - Ensure the list of touched files matches what’s in `docs/planning/phase-80/plan.md` **Key Files**.

3. **Replace inline logic with centralized helper:**
   - Replace duplicated blocks with `pauseFollowUpsOnBooking(leadId, ...)`.
   - Keep exclusions consistent (do not affect post-booking sequences where `triggerOn === "meeting_selected"`).

4. **Validation (RED TEAM):**
   - Run `npm run lint` and `npm run build`.
   - Manual smoke test (minimum):
     - Book via GHL path → follow-ups stop as expected.
     - Book via Calendly webhook path → follow-ups stop as expected.
     - Book via reconcile paths → follow-ups stop as expected.

## Output

- All booking paths use the same centralized follow-up pause/complete behavior.
- No remaining duplicated “complete follow-ups on booking” blocks.

## Handoff

Phase 80 complete. Do a final consolidated verification pass and resolve any merge conflicts with Phases 79/81 (drafting + schema + orchestrator + settings UI).
