# Phase 173c — Event Trigger Wiring (Lead Interest + CRM Edit Paths)

## Focus
Connect CRM webhook event creation to the two required change paths: lead interest CRM upsert and analytics CRM sheet edits.

## Inputs
- Prior subphase output: `docs/planning/phase-173/b/plan.md`
- Trigger candidates:
  - `lib/lead-crm-row.ts` (`upsertLeadCrmRowOnInterest`)
  - `lib/inbound-post-process/pipeline.ts`
  - `lib/background-jobs/email-inbound-post-process.ts`
  - `lib/background-jobs/sms-inbound-post-process.ts`
  - `lib/background-jobs/linkedin-inbound-post-process.ts`
  - `actions/analytics-actions.ts` (`updateCrmSheetCell`)

## Work
1. Add enqueue helper for CRM webhook events that accepts:
  - workspace/client id
  - lead id
  - optional message id (when available)
  - event type
  - stable dedupe key components
  - normalized payload snapshot
2. Trigger `lead_created` (or equivalent create/update event) from `upsertLeadCrmRowOnInterest` path when positive-interest CRM row is created/updated.
3. Trigger `crm_row_updated` from `updateCrmSheetCell` when watched fields change:
  - `leadCategory`
  - `leadStatus`
  - `leadType`
  - `applicationStatus`
  - `notes`
  - `campaign`
4. Guard enqueueing behind webhook settings (`enabled` and valid URL).
5. Enqueue events into durable `WebhookEvent` rows (CRM outbound provider/event) rather than `BackgroundJob`, because CRM edit events are not message-centric.
6. Ensure failures to enqueue do not corrupt primary CRM update flows; log with actionable context.

## Validation
- Simulated create/update path confirms event enqueue attempts are made only when configured.
- No duplicate enqueue for identical event dedupe windows.
- Primary CRM updates still succeed when webhook is disabled or endpoint unreachable.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added durable enqueue helper `lib/crm-webhook-events.ts` that:
    - resolves effective dispatch config from workspace settings
    - skips safely when disabled/misconfigured
    - builds deterministic dedupe keys
    - persists events via `WebhookEvent` (`provider=CRM`) using upsert on `dedupeKey`
  - Wired `lead_created` enqueue from `lib/lead-crm-row.ts` (`upsertLeadCrmRowOnInterest`).
  - Wired `crm_row_updated` enqueue from `actions/analytics-actions.ts` (`updateCrmSheetCell`) for watched fields:
    - `leadCategory`, `leadStatus`, `leadType`, `applicationStatus`, `notes`, `campaign`
  - Preserved primary CRM write path success on enqueue failure by using non-fatal logging (`console.warn`) in async enqueue catch blocks.
- Commands run:
  - `npm run test` — pass.
- Blockers:
  - None.
- Next concrete steps:
  - Complete delivery processor + queue runner integration in `173d`.

## Output
- Trigger integration merged:
  - lead-interest upsert path emits `lead_created`
  - watched CRM edit path emits `crm_row_updated`
- Event enqueue now uses `WebhookEvent` with stable dedupe keys and payload snapshot handoff for async delivery.

## Handoff
Proceed to **173d** to implement CRM outbound processor in webhook-event runner with signing, retry policy, and terminal error handling.
