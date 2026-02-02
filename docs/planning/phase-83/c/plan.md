# Phase 83c — Live Automation Plan (Interest → CRM Row)

## Focus
Define how leads automatically get added to the CRM table the moment they “register interest”, and how the row stays current.

## Inputs
- Existing sentiment classification pipelines:
  - `lib/inbound-post-process/pipeline.ts` (email)
  - `lib/background-jobs/sms-inbound-post-process.ts` (sms)
- Existing attribution primitives:
  - `Message.sentBy` / `Message.sentByUserId`
  - campaign links on `Lead`
- Lead scoring: `enqueueLeadScoringJob` + `Lead.overallScore`

## Work
- Define “registered interest” trigger:
  - Likely: `isPositiveSentiment(sentimentTag)` at time of inbound processing
  - Capture first time only (`interestRegisteredAt` stays stable) + store latest interest type if it changes
- Define attribution logic (AI vs human):
  - Choose a deterministic rule (e.g., most recent outbound message before the inbound interest within the same channel)
  - Store `responseMode` = `ai` when `Message.sentBy === "ai"` else `setter`
- Define campaign attribution:
  - Prefer FK ids (`emailCampaignId` / `smsCampaignId`) plus optional snapshot name for historical integrity
- Define update rules:
  - Booking/meeting dates update from `Lead.appointmentBookedAt` / `Appointment.startAt`
  - Lead score columns update after scoring completes (best-effort refresh)
  - Manual pipeline/sales call fields remain user-editable only (future UI/actions)
- Idempotency:
  - Unique key = `leadId` (or `leadId + interestMessageId` if multi-interest rows are desired)
  - Upsert semantics safe on webhook retries

## Output
- A precise “event → upsert” spec for implementation (what updates when, and what never overwrites user edits).

## Handoff
Use this spec to design server actions + queries powering the Analytics table (Phase 83d).

