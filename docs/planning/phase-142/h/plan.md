# Phase 142h — Ingestion Wiring (Calendly + GHL)

## Focus

Create deterministic job enqueue points for both providers without blocking synchronous booking paths.

## Inputs

- 142g complete (schema + queue enqueue helpers)
- Existing provider entrypoints:
  - `app/api/webhooks/calendly/[clientId]/route.ts`
  - `lib/ghl-appointment-reconcile.ts`

## Work

1. Calendly webhook updates:
- Parse `invitee.questions_and_answers` into normalized `{ question, answer, position }`.
- Fix routing so both event type URIs are accepted:
  - qualification link (`calendlyEventTypeUri`)
  - direct-book link (`calendlyDirectBookEventTypeUri`)
- Qualification-link path:
  - persist answers to lead (`confidence: 1.0`)
  - set lead qualification status to `pending`
  - enqueue booking qualification job with dedupe key
  - avoid starting post-booking sequence before qualification result.
- Direct-book path:
  - no enqueue
  - preserve existing booking side effects.

2. GHL reconcile updates:
- Read contact `customFields` relevant to qualification answers.
- Normalize and persist answers to lead.
- If workspace qualification is enabled and criteria exists, enqueue GHL booking qualification job.

3. Shared helper adjustment:
- Export or relocate `normalizeQuestionKey()` so both booking and qualification paths can reuse it.

## Validation

- Add/adjust targeted tests:
  - Calendly qualification-link enqueue
  - Calendly direct-book no-enqueue
  - GHL reconcile enqueue from custom fields
  - enqueue dedupe behavior
- `npm run lint`
- `npm run build`

## Output

- Implemented Calendly ingestion updates in `app/api/webhooks/calendly/[clientId]/route.ts`:
  - Parses `invitee.questions_and_answers`.
  - Accepts both configured event type URIs (with-questions + direct-book) for webhook filtering.
  - Qualification-link path:
    - stores normalized answers on lead (`confidence: 1.0`)
    - marks lead `bookingQualificationStatus = "pending"`
    - enqueues `BookingQualificationJob` with deterministic dedupe key
    - skips post-booking auto-start while qualification is pending.
  - Direct-book path:
    - no enqueue
    - existing booking side effects preserved.
- Implemented GHL ingestion updates in `lib/ghl-appointment-reconcile.ts`:
  - On new booking transition, reads GHL contact `customFields`.
  - Maps custom field answers to workspace qualification questions.
  - Stores answers on lead, marks pending, and enqueues GHL qualification job.
  - Skips post-booking auto-start when qualification job is queued.
- Shared helper update:
  - Exported `normalizeQuestionKey()` from `lib/booking.ts`.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Wired both provider ingestion paths to the new queue model.
  - Added fail-safe gating so direct-book flows remain unchanged.
- Commands run:
  - `DATABASE_URL=... DIRECT_URL=... OPENAI_API_KEY=test node --conditions=react-server --import tsx --test lib/__tests__/booking-qualification.test.ts lib/__tests__/booking-qualification-cron-lock.test.ts lib/__tests__/calendly-invitee-questions.test.ts` — pass.
  - `npm run lint` — pass (warnings only; no new lint errors from this subphase).
- Blockers:
  - None in this subphase.
- Next concrete steps:
  - Implement queue processor + disqualification orchestration + cron route.
  - Complete end-to-end validation and settings/follow-up guard checks.

## Handoff

- 142i should process queued jobs and execute high-confidence disqualification.
- Reuse provider metadata now emitted in payload:
  - Calendly payload includes `scheduledEventUri` / `inviteeUri`.
  - GHL payload includes `ghlAppointmentId` / `ghlContactId`.
