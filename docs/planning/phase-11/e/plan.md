# Phase 11e — Auto-Booking Integration + End-to-End Validation

## Focus
Integrate Calendly as an alternative booking provider within the existing auto-booking system while retaining the same logic (slot selection, safety gates, follow-up behavior), and validate the end-to-end flow.

## Inputs
- Phase 11d webhook → state mapping.
- Existing auto-booking + availability logic in `lib/**`.
- Existing messaging send paths for SMS/email/LinkedIn (where the booking link is delivered).

## Work
- Add provider selection logic:
  - If workspace booking provider is Calendly, generate/send the appropriate Calendly link (single-use if supported/required).
  - Keep the same downstream “booked” transitions by relying on Calendly webhook confirmation.
- Ensure compatibility with existing “offered slot ledger” / availability distribution logic:
  - If Calendly cannot be directly booked via API, adapt by mapping “slot offers” → “send link + suggested time options” while preserving guardrails.
- Validate:
  - Local dev: webhook endpoint accepts signed sample payloads and performs idempotent upserts.
  - UI: settings save/disable paths work and do not break other integrations.
  - Run `npm run lint` and `npm run build`.

## Output
- Implemented provider-aware auto-booking:
  - Added `lib/booking.ts` `bookMeetingForLead()` to select between GHL and Calendly based on `WorkspaceSettings.meetingBookingProvider`.
  - Added `lib/booking.ts` `bookMeetingOnCalendly()` using Calendly `POST /invitees` to schedule on behalf of the lead.
  - Updated `processMessageForAutoBooking()` to call `bookMeetingForLead()` instead of the GHL-only path.
- Generalized “already booked” detection across the app to include Calendly (`calendlyInviteeUri`) in:
  - auto-book gating (`shouldAutoBook`)
  - follow-up automation gates (meeting-requested/no-response/post-booking sequence logic)
  - booking status + analytics meeting counts.
- Added Calendly event-type resolution from a public Calendly link and cached the resulting API event type URI (`lib/calendly-link.ts`).

## Handoff
- If we need tighter security/robustness, follow-on improvements:
  - Confirm the exact Calendly webhook signature scheme/headers and tighten verification (currently best-effort with multiple header patterns).
  - Add a provider-aware manual “Book Meeting” action in the CRM drawer (today it still calls the GHL-only server action).
