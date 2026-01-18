# Phase 36 — Review

## Summary
- Booking processes are modeled in Prisma and configurable in the UI (create/edit/duplicate/delete).
- Campaigns can be assigned a booking process via the existing campaign assignment settings UI.
- Draft generation injects stage-specific booking-process instructions and booking-wave progress is recorded on outbound sends (email/SMS/LinkedIn) via `lib/booking-progress.ts`.
- Booking-process analytics and comparisons are implemented, leveraging `LeadCampaignBookingProgress` outbound counters/wave tracking.
- Multipart SMS is implemented end-to-end (1–3 parts, strict 160 chars/part) with idempotency using `(aiDraftId, aiDraftPartIndex)`.
- LinkedIn drafting now uses a LinkedIn-specific prompt (no SMS 160-char constraint).
- Quality gates: `npm run lint` passes (warnings only); `npm run build` passes; `npm run db:push` reports DB already in sync.

## What Shipped
- Schema
  - `prisma/schema.prisma` (BookingProcess, BookingProcessStage, LeadCampaignBookingProgress, EmailCampaign.bookingProcessId, Message.aiDraftPartIndex, AIDraft.sentMessages)
- Booking process CRUD + templates
  - `actions/booking-process-actions.ts`
  - `lib/booking-process-templates.ts`
- Campaign assignment
  - `actions/email-campaign-actions.ts` (`assignBookingProcessToCampaign`)
  - `components/dashboard/settings/ai-campaign-assignment.tsx` (Booking Process dropdown)
- Draft integration
  - `lib/booking-process-instructions.ts`
  - `lib/ai-drafts.ts` (injects booking instructions)
- Multipart SMS (Phase 36i completion)
  - `lib/sms-multipart.ts` (parse/validate/split helpers)
  - `actions/message-actions.ts` (`approveAndSendDraftSystem` sends multipart SMS + records wave once)
  - `lib/system-sender.ts` (part-aware idempotency + persistence)
- Analytics (partial)
  - `actions/booking-process-analytics-actions.ts`
  - `components/dashboard/settings/booking-process-analytics.tsx`
- Progress tracking + DND retry
  - `lib/booking-progress.ts` (wave tracking, stage selection, DND hold helpers)
  - `lib/booking-sms-dnd-retry.ts` (2h retry / 72h timeout)
  - `app/api/cron/followups/route.ts` (invokes `retrySmsDndHeldLeads`)

## Verification

### Commands (2026-01-18)
- `npm run lint` — pass (0 errors, 16 warnings)
- `npm run build` — pass (Next.js warnings: multiple lockfiles + middleware deprecation)
- `npm run db:push` — pass (“The database is already in sync with the Prisma schema.”)

### Repo state (evidence)
- Working tree contains many uncommitted changes and new files (`git status --porcelain=v1`).
- Phase 36 artifacts are present, but some planned wiring is incomplete (see Success Criteria + Follow-ups).

## Success Criteria → Evidence

1) User can create a booking process with multiple stages, each configuring: booking link, suggested times, qualifying questions, timezone ask
   - Evidence:
     - `actions/booking-process-actions.ts` (CRUD + stage validation)
     - `components/dashboard/settings/booking-process-manager.tsx` (builder UI)
     - `prisma/schema.prisma` (BookingProcess + BookingProcessStage)
   - Status: met

2) User can assign a booking process to any synced campaign
   - Evidence:
     - `actions/email-campaign-actions.ts` (`assignBookingProcessToCampaign`)
     - `components/dashboard/settings/ai-campaign-assignment.tsx` (dropdown + save)
     - `prisma/schema.prisma` (`EmailCampaign.bookingProcessId`)
   - Status: met

3) AI drafts respect booking process rules based on current wave stage for that lead/campaign/channel
   - Evidence:
     - `lib/booking-process-instructions.ts` (stage selection + instructions)
     - `lib/ai-drafts.ts` (injects booking instructions into draft generation)
     - Wave/outbound progress updates are wired into send flows via `recordOutboundForBookingProgress`:
       - `actions/email-actions.ts`
       - `actions/message-actions.ts` (LinkedIn)
       - `lib/system-sender.ts` (SMS)
   - Status: met (implementation-level; validate with real send flows)

4) Analytics show metrics (booked rate, avg replies to book) filterable by booking process
   - Evidence:
     - `actions/booking-process-analytics-actions.ts` (queries over `LeadCampaignBookingProgress`)
     - `components/dashboard/settings/booking-process-analytics.tsx` (UI)
   - Status: met (implementation-level; depends on outbound counters being populated + schema applied to the target DB)

5) A/B testing scenario works: same copy, different booking process, compare results
   - Evidence:
     - Per-campaign assignment exists (`EmailCampaign.bookingProcessId` + UI).
     - Comparison queries exist (`actions/booking-process-analytics-actions.ts:compareBookingProcesses`).
   - Status: met (implementation-level; depends on real campaign data + schema applied to the target DB)

## Plan Adherence
- Planned vs implemented deltas:
  - Multipart SMS is now end-to-end: SMS drafts can contain 1–3 parts separated by `---`, each part is strictly ≤160 chars, and sending is idempotent per part.
  - SMS length is enforced deterministically at send-time (with a fallback splitter) via `lib/sms-multipart.ts`.
  - Required-question rotation + attribution is implemented and stored (`lib/booking-process-instructions.ts`, `lib/booking-progress.ts:storeSelectedRequiredQuestions`).
  - Wave skipping + freeze semantics are implemented: waves advance when a stage has no sendable channels, and campaign reassignment does not retroactively change in-progress conversations (`LeadCampaignBookingProgress.activeBookingProcessId` is source of truth).

## Risks / Rollback
- Risk: Booking process stage/wave semantics may not match operator expectations (global wave across channels can “stall” if a channel is enabled+sendable but never used).
  - Mitigation: verify semantics against real follow-up sequencing flows; consider a per-channel wave option if needed.
- Risk: SMS DND retry behavior depends on periodic cron execution; if cron is disabled, held leads will not retry.
  - Mitigation: confirm Vercel cron is enabled for `/api/cron/followups` and that `retrySmsDndHeldLeads()` runs as expected.

## Follow-ups
- Add a small manual QA checklist for booking-process progression (wave increments + stage selection + analytics attribution) using a test workspace/campaign.
