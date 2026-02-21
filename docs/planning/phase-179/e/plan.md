# Phase 179e — Policy Hardening: Process 5 Manual-Only + Meeting Booked Evidence Gate + Prompt Alignment

## Focus
Lock deterministic invariants so prompts can’t reintroduce FC trust-killing failures:
- Booking router Process 5 (lead scheduler link / external calendar) is manual-only (no auto-send).
- “Meeting Booked” is provider-evidence backed only (Appointment/provider IDs).

## Inputs
- Phase 179 root decisions (Process 5 blocks auto-send; Meeting Booked requires provider evidence).
- Existing authority helpers: `lib/meeting-lifecycle.ts` and `Appointment` model in `prisma/schema.prisma`.
- Existing Process 5 manual task path: `lib/lead-scheduler-link.ts`.
- Sentiment prompt sources:
  - `lib/ai/prompts/sentiment-classify-v1.ts`
  - fallbacks in `lib/sentiment.ts` and `app/api/webhooks/email/route.ts`

## Work
1. Sentiment invariant: provider-evidence-only “Meeting Booked”
   - When any classifier (AI or inbox cleaner) returns `Meeting Booked` but provider evidence is missing:
     - downgrade to `Meeting Requested` (and map lead status accordingly).
   - Provider evidence check must include:
     - Lead provider IDs: `Lead.ghlAppointmentId` OR `Lead.calendlyInviteeUri` OR `Lead.calendlyScheduledEventUri`, OR
     - Appointment history: at least one `Appointment` row for the lead where `status != CANCELED`.
   - Apply this downgrade at every sentiment-set write path used by:
     - `app/api/webhooks/email/route.ts` (inbound webhook ingestion)
     - `lib/inbound-post-process/pipeline.ts`
     - `lib/background-jobs/email-inbound-post-process.ts`
     - `lib/background-jobs/sms-inbound-post-process.ts`
     - `lib/background-jobs/linkedin-inbound-post-process.ts`
2. Prompt alignment: remove “book via their link” ⇒ `Meeting Booked` guidance
   - Update:
     - `lib/ai/prompts/sentiment-classify-v1.ts`
     - fallback prompt text in `lib/sentiment.ts` (EMAIL_INBOX_MANAGER_SYSTEM)
   - New rule:
     - explicit external scheduler instruction should classify as `Meeting Requested` and trigger Process 5 routing (manual).
3. Auto-send invariant: Process 5 / external scheduler link blocks auto-send
   - If booking router selects `processId=5` OR action signals include `book_on_external_calendar` OR `leadSchedulerLink` is present:
     - hard-block auto-send (even when `emailCampaign.responseMode === AI_AUTO_SEND`)
     - route to manual handling (task + Slack notify).
   - Implement at a single gating layer (preferred: `lib/auto-send-evaluator.ts`) so all channels behave consistently.
4. Regression coverage
   - Add tests ensuring:
     - text-only `Meeting Booked` is downgraded when provider evidence is missing
     - Process 5 blocks auto-send reliably
     - external scheduler instruction does not yield `Meeting Booked` in sentiment fixtures/prompt text

## Output
- Deterministic invariants implemented + tests/fixtures updated.

## Handoff
Phase 179f can assume Process 5 is manual-only and “Meeting Booked” cannot be set from text-only messages.
