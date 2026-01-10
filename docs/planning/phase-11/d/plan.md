# Phase 11d — Webhook Ingestion → Appointment/Lead Lifecycle Mapping

## Focus
Create the Calendly webhook endpoint(s) and map incoming events into the app’s existing appointment/lead lifecycle so downstream logic (follow-ups, booking status, AI gating) behaves consistently.

## Inputs
- Phase 11c client + webhook security validation approach.
- Existing webhook ingestion patterns under `app/api/webhooks/**`.
- Current internal appointment representations and lead lifecycle transitions.

## Work
- Add `app/api/webhooks/calendly/route.ts` (or equivalent) that:
  - Validates webhook authenticity before reading/parsing the body (per repo conventions).
  - Normalizes payloads and safely handles missing/unknown fields.
  - Dedupe/idempotency: upsert based on stable Calendly IDs (event/invitee).
- Map events to internal state:
  - On “scheduled”: associate with workspace + lead, mark booking status, record meeting metadata.
  - On “canceled”: update internal appointment status and ensure follow-up logic reacts appropriately.
- Ensure observability:
  - Log key IDs/statuses (without secrets) so failures are diagnosable.
  - Store raw payload reference only if consistent with existing patterns and privacy constraints.

## Output
- Added `POST /api/webhooks/calendly/[clientId]` to ingest `invitee.created` + `invitee.canceled` events.
- Implemented best-effort webhook authenticity verification using `Client.calendlyWebhookSigningKey` (falls back to `CALENDLY_WEBHOOK_SIGNING_KEY` if set; logs warning if neither exists).
- Mapped events → lead lifecycle:
  - On `invitee.created`: set Calendly IDs on `Lead`, mark `status = "meeting-booked"`, clear `offeredSlots`, and apply post-booking follow-up side effects.
  - On `invitee.canceled`: clear booking fields and downgrade `status` from `meeting-booked` → `qualified`.
- Mapping strategy is idempotent and prefers stable IDs (invitee URI / scheduled event URI) before falling back to invitee email.

## Handoff
- Phase 11e should:
  - Implement Calendly scheduling (auto-book) using the stored event type config + workspace token.
  - Update auto-book gating to consider Calendly bookings as “already booked” (not just `ghlAppointmentId`).
  - Ensure the Calendly webhook mapping aligns with the booking call’s stored identifiers (invitee URI / scheduled event URI).
