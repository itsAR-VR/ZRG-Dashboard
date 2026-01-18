# Phase 34d — Webhooks → Appointment History

## Focus
Ensure webhook ingestion writes appointment events to `Appointment` history and keeps lead rollups consistent.

## Inputs
- Calendly webhook:
  - `app/api/webhooks/calendly/[clientId]/route.ts`
  - `lib/calendly-webhook` (signature verification)
- Appointment reconciliation:
  - `lib/calendly-appointment-reconcile.ts`
- Meeting lifecycle semantics:
  - `lib/meeting-lifecycle.ts`

## Work
1. Calendly webhook dual-write:
   - Preserve existing signature verification (`verifyCalendlyWebhookSignature`) and “untrusted input” parsing.
   - On `invitee.created`: upsert an `Appointment` row (keyed by `calendlyInviteeUri`), set status confirmed, set times.
   - On `invitee.canceled`: update appointment status/canceledAt; keep prior rows for audit.
   - Update lead rollup fields from the primary appointment selection rule.
2. Reschedule handling:
   - If Calendly signals a reschedule via payload fields, link the chain best-effort (`rescheduledFromId`).
   - If not available, treat as cancel + new appointment; still preserve history via separate rows.
3. PII safety:
   - Do not store raw webhook payloads unless redacted; never log emails/phones.
4. GHL appointment webhooks:
   - Only if a stable webhook exists for appointment events; otherwise keep Phase 28 cron reconciliation as the source of truth.

## Validation (RED TEAM)
- Replay sample webhook payloads in dev:
  - ensure idempotency (same webhook event does not create duplicates)
  - ensure lead rollups remain correct
- `npm run lint`
- `npm run build`

## Output

### Files Modified

**`app/api/webhooks/calendly/[clientId]/route.ts`**
- Added imports for `upsertAppointmentWithRollup`, Prisma enums, and `createCancellationTask`
- Modified `invitee.created` handler:
  - Uses `upsertAppointmentWithRollup()` for dual-write when inviteeUri is present
  - Fallback to direct lead update for legacy cases without inviteeUri
  - Source set to `AppointmentSource.WEBHOOK`
- Modified `invitee.canceled` handler:
  - Looks up existing appointment start time for cancellation task
  - Uses `upsertAppointmentWithRollup()` for dual-write with canceled status
  - Creates cancellation task via `createCancellationTask()` for follow-up UI visibility
  - Fallback to direct lead update for legacy cases

### GHL Note

GHL does not have stable appointment webhooks, so Phase 28 cron reconciliation (`/api/cron/appointment-reconcile`) remains the source of truth for GHL appointments. This was already updated in Phase 34c via `lib/ghl-appointment-reconcile.ts`.

### Validation Results

- `npm run lint` — pass (17 warnings, all pre-existing)
- `npm run build` — pass
- Idempotency preserved: Same webhook event will not create duplicates (keyed by `calendlyInviteeUri`)
- Side effects preserved: Post-booking sequences and cancellation tasks remain correct

## Handoff

Proceed to Phase 34e: API endpoints for querying appointment history and optional UI integration.

Key work items:
1. Create API endpoint for appointment history per lead
2. Update lead detail views to display appointment history (optional)
3. Ensure proper access control on new endpoints
