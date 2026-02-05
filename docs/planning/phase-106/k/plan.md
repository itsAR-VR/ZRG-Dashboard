# Phase 106k — Implementation: Auto-Booking Slot Selection + Confirmations

## Focus
Make auto-booking deterministic and preference-aware, and send confirmation replies after booking across email/SMS/LinkedIn.

## Inputs
- Auto-booking logic: `lib/followup-engine.ts`
- Booking helpers: `lib/booking.ts`
- Sender utilities: `lib/email-send.ts`, `lib/system-sender.ts`, `lib/unipile-api.ts`
- Availability formatting: `lib/availability-format.ts`

## Work
1. Add deterministic slot selection (weekday/time-of-day matching; fallback to first offered slot).
2. If acceptance is vague or “later this week”, issue a clarification task instead of booking.
3. Add system-level confirmation senders for email/SMS/LinkedIn.
4. Ensure auto-booking returns `booked=true` only after confirmation send attempt.

## Output
- Auto-booking reliably books the correct slot and sends confirmation messages.

## Handoff
Proceed to drafting gate integration (Phase 106l).
