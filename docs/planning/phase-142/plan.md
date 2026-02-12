# Phase 142 — Post-Booking Qualification Check & Auto-Disqualification

## Purpose

When a lead books from either Calendly or GHL, run an AI qualification check asynchronously and auto-disqualify (cancel + notify) only when confidence is high.

## Resolved Product Decisions

- Include both providers now: **Calendly + GHL**.
- Use AI evaluation (not static rules), fully automated.
- Same-channel notification (Calendly => email, GHL => SMS).
- Keep default cancellation follow-up task behavior.
- Fail-open on uncertainty, model errors, low confidence, or missing qualification setup.
- Do **not** rely on `BackgroundJob.messageId`.
- Use a dedicated queue for this feature: new booking-qualification jobs table + dedicated cron route.

## Why This Plan Changed

The prior plan assumed booking qualification must piggyback on `BackgroundJob` (`messageId` required).  
That assumption is wrong for external first-touch bookings where no message row exists.  
The simplest correct fix is a booking-only queue model.

## Scope

In scope:
- New queue schema + runner for booking qualification jobs.
- Calendly webhook ingestion and GHL reconcile ingestion.
- Provider-specific cancellation + lead/appointment updates.
- Settings toggle + criteria + message template.
- Timeout-safe cron processing with bounded retries and budgets.

Out of scope:
- Generic cross-feature async queue framework.
- Refactors outside qualification-related callsites.
- New GHL appointment webhook architecture.

## Karpathy Guardrails Applied

- Think before coding: all high-impact assumptions are explicit in this file.
- Simplicity first: booking-only queue table (not generalized infra).
- Surgical changes: only qualification paths and required shared touch points.
- Goal-driven execution: each subphase below has concrete verification checks.

## Repo Reality Check

Verified current state:
- `app/api/webhooks/calendly/[clientId]/route.ts` currently hard-filters by `calendlyEventTypeUri` and can drop direct-book events.
- `lib/background-jobs/enqueue.ts` requires `messageId`; not suitable for external booking-only flows.
- `lib/calendly-api.ts` does not yet expose cancellation helper.
- `lib/ghl-api.ts` has appointment delete helper but `GHLContact` type does not include `customFields`.
- `lib/booking.ts` has `normalizeQuestionKey()` but it is not exported.
- `app/api/cron/appointment-reconcile/route.ts` already runs with `maxDuration = 800`.
- Existing cron processors use explicit time budgets and early-break safety checks.

## Architecture (Final)

1. Ingestion:
- Calendly webhook parses form answers for qualification-link event types.
- GHL appointment reconciliation extracts qualification answers from contact custom fields.
- Both enqueue `BookingQualificationJob` with provider and anchor identifiers.

2. Async processing:
- New cron route drains `BookingQualificationJob` rows with lock + budget checks.
- For each job: evaluate qualification via structured JSON prompt.
- If disqualified with confidence >= 0.7: cancel booking, update lead/appointment state, send message.
- Else: mark qualified and continue normal flow.

3. Safety:
- Fail-open for all uncertain/error branches.
- Idempotent enqueue via unique dedupe key.
- Bounded retries and hard cron time budget.

## Data Model Changes

### New table: `BookingQualificationJob`

Columns:
- `id` (uuid PK)
- `clientId` (FK)
- `leadId` (FK)
- `provider` (`CALENDLY` | `GHL`)
- `anchorId` (provider anchor; invitee URI/scheduled event URI/appointment ID)
- `dedupeKey` (unique)
- `payload` (JSON; normalized answers + provider metadata)
- `status` (`PENDING` | `RUNNING` | `SUCCEEDED` | `FAILED`)
- `runAt`, `attempts`, `maxAttempts`, `lockedAt`, `lockedBy`, `lastError`
- `createdAt`, `updatedAt`

Indexes:
- unique `dedupeKey`
- `(status, runAt)`
- `(clientId, leadId, provider)`

### `WorkspaceSettings`

Add:
- `bookingQualificationCheckEnabled Boolean @default(false)`
- `bookingQualificationCriteria String? @db.Text`
- `bookingDisqualificationMessage String? @db.Text`

### `Lead`

Add:
- `bookingQualificationStatus String?` (`pending` | `qualified` | `disqualified`)
- `bookingQualificationCheckedAt DateTime?`
- `bookingQualificationReason String? @db.Text`

## Timeout/Performance Constraints

- New cron route exports `maxDuration = 800`.
- Internal processor budget: `240_000ms`.
- Early-break buffer: `7_500ms`.
- Provider call timeout target: `10_000-20_000ms`.
- Retry policy: max attempts `3`, exponential backoff, no unbounded loops.

These align with existing repo cron patterns and Vercel maxDuration docs.

## Key File Plan

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `BookingQualificationJob`, lead + workspace fields |
| `lib/booking-qualification-jobs/enqueue.ts` | New enqueue + dedupe helpers |
| `lib/booking-qualification-jobs/runner.ts` | New bounded processor loop |
| `app/api/cron/booking-qualification-jobs/route.ts` | New dedicated cron endpoint with lock + budget |
| `lib/booking-qualification.ts` | Evaluation + disqualification orchestration |
| `lib/calendly-api.ts` | Add `cancelCalendlyScheduledEvent()` + invitee QA typing |
| `lib/ghl-api.ts` | Extend contact typing for `customFields` parsing |
| `app/api/webhooks/calendly/[clientId]/route.ts` | Route filtering fix + enqueue for qualification link only |
| `lib/ghl-appointment-reconcile.ts` | Enqueue qualification jobs from reconcile path |
| `actions/settings-actions.ts` | Read/write new settings fields with admin gating |
| `components/dashboard/settings-view.tsx` | UI controls for toggle/criteria/template |
| `lib/followup-automation.ts` | Guard disqualified leads from post-booking starts |

## Success Criteria

- Qualification-link bookings enqueue exactly one job per booking event (deduped).
- Direct-book bookings are still ingested and do not enqueue qualification jobs.
- GHL bookings through reconcile path enqueue jobs when qualification is enabled and data is available.
- Disqualified (confidence >= 0.7):
  - booking canceled with correct provider API call,
  - lead status set to `unqualified`,
  - booking qualification fields set,
  - notification sent.
- Fail-open branches mark lead qualified and do not cancel booking.
- `npm run lint`, `npm run build`, and `npm run db:push` pass.

## Subphase Index

Historical subphases (retain as reference): `a` through `f`.  
Active implementation subphases (final architecture): `g` through `i`.

- a — Legacy schema/background-job approach (superseded)
- b — Legacy Calendly API extension (partially reusable)
- c — Legacy core logic draft (superseded by queue pivot)
- d — Legacy BackgroundJob runner path (superseded)
- e — Legacy webhook/settings wiring (partially reusable)
- f — RED TEAM hardening addendum (completed)
- g — Schema + queue primitives + settings model updates
- h — Ingestion wiring (Calendly webhook + GHL reconcile enqueue)
- i — Processor, disqualification execution, and validation loop

## Goal-Driven Execution Checklist

1. Build queue schema and primitives.
   - Verify: `npm run db:push` and schema indexes exist.
2. Wire ingestion paths for both providers.
   - Verify: enqueue dedupe tests pass for Calendly + GHL.
3. Implement processor and disqualification execution.
   - Verify: provider cancel mocks + fail-open + confidence-threshold tests pass.
4. Wire settings and follow-up guard.
   - Verify: admin-only settings save + disqualified guard test pass.
5. End-to-end quality gates.
   - Verify: `npm run lint` and `npm run build` pass.

## Assumptions

- GHL qualification answer extraction is available from contact `customFields` at reconcile time.
- Existing cancellation task behavior is intentionally preserved.
- `lead.status = "unqualified"` remains the canonical disqualification status for downstream filters.

## Success Criteria Status (2026-02-12)

- [x] Qualification-link bookings enqueue exactly one job per booking event (dedupe enforced).
- [x] Direct-book bookings stay ingested and do not enqueue qualification jobs.
- [x] GHL reconcile path enqueues jobs when qualification is enabled and custom-field data maps to workspace questions.
- [x] High-confidence disqualification path implemented (provider cancellation + lead updates + notification + qualification state writes).
- [x] Fail-open paths implemented for missing setup, no answers, evaluation failures, and low-confidence disqualification.
- [x] `npm run db:push` passed.
- [x] `npm run lint` passed (warnings only).
- [ ] `npm run build` passed.
  - Blocked by unrelated concurrent type mismatch in `lib/inbound-post-process/pipeline.ts` (outside Phase 142 files).

## RED TEAM Wrap-up (Terminus Maximus)

- Multi-agent overlap detected and merged carefully:
  - `actions/settings-actions.ts` and `components/dashboard/settings-view.tsx` are active in phases 141/144.
  - Changes were limited to booking-qualification fields and reused existing admin-gating/save patterns.
- Architecture check after implementation:
  - No dependency introduced on `BackgroundJob.messageId`.
  - Dedicated queue + dedicated cron route confirmed on disk.
  - Calendly webhook now supports both configured event type URIs before filtering.
- Remaining risk:
  - Global build signal is currently noisy because an unrelated in-flight change fails typecheck.

## Open Questions (<90% Confidence)

1. Should Phase 142 absorb and patch the unrelated `actionSignals` type mismatch so the global build gate can be marked green?
   - Why it matters: done-definition requires `npm run build` pass for closure.
   - Current default: treat as external blocker and avoid cross-phase edits.
   - Confidence in default: 0.83.

## Phase Summary (running)

- 2026-02-12 00:00 UTC — Implemented Phase 142 `g/h/i`: booking qualification schema + queue primitives, Calendly/GHL ingestion enqueue, dedicated cron processor/disqualification orchestration, settings/follow-up guard wiring, and targeted tests. (files: `prisma/schema.prisma`, `lib/booking-qualification-jobs/enqueue.ts`, `lib/booking-qualification-jobs/runner.ts`, `lib/booking-qualification.ts`, `app/api/cron/booking-qualification-jobs/route.ts`, `app/api/webhooks/calendly/[clientId]/route.ts`, `lib/ghl-appointment-reconcile.ts`, `actions/settings-actions.ts`, `components/dashboard/settings-view.tsx`, `lib/followup-automation.ts`, `lib/calendly-api.ts`, `lib/ghl-api.ts`, `vercel.json`, tests)
- 2026-02-12 00:00 UTC — Validation completed: `npm run db:push` pass, targeted tests pass, `npm run lint` pass, `npm run build` blocked by unrelated concurrent type mismatch (`lib/inbound-post-process/pipeline.ts`). 
