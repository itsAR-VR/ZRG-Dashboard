# Phase 36g — RED TEAM Fixups (Preflight)

## Focus

Reconcile Phase 36 assumptions with repo reality and lock down remaining semantics (stage counting, “booked” definition, link/qualification sources) so implementation doesn’t ship a “looks-configurable-but-doesn’t-work” version.

## Inputs

- Root plan: `docs/planning/phase-36/plan.md`
- Schema + existing helpers:
  - `prisma/schema.prisma` (`EmailCampaign`, `Lead.emailCampaignId`, `WorkspaceSettings.qualificationQuestions`, `CalendarLink`, `Lead.preferredCalendarLinkId`)
  - `lib/meeting-booking-provider.ts:getBookingLink`, `lib/meeting-booking-provider.ts:isMeetingBooked`
  - `lib/ai-drafts.ts:generateResponseDraft`
  - `lib/availability-cache.ts:getWorkspaceAvailabilitySlotsUtc`
  - `lib/followup-engine.ts:generateFollowUpMessage`, `lib/followup-engine.ts:processMessageForAutoBooking`
  - `actions/email-campaign-actions.ts:updateEmailCampaignConfig`
  - `components/dashboard/settings/ai-campaign-assignment.tsx`

## Work

### 1) Decide stage counting semantics (highest risk)

Decide whether `BookingProcessStage.stageNumber` should map to:

- **Option A — Per-channel reply number** (email reply #, sms reply #, linkedin reply # are independent)
- **Option B — Global “wave” number** (shared stage index; a stage can send across multiple channels in the same wave, like FollowUpSequence dayOffset groupings)

**If Option B:**

- Update the reply-tracking design to include a single wave counter (e.g., `waveCount Int @default(0)` + `lastWaveAt DateTime?`), independent of per-channel counters.
- Define how a wave increments (e.g., when at least one outbound message is sent for that stage).
- Define how channel-skipped waves behave (so per-channel counts can diverge without breaking stage lookup).

### 2) Lock booking link source of truth

- Use `getBookingLink(clientId, settings)` for booking-link insertion (provider-aware).
- Confirm whether per-lead `preferredCalendarLinkId` should override workspace default for booking processes.
- Confirm whether “hyperlinked text” is allowed only for email/linkedin (SMS should always be plain URL).

### 3) Lock qualification question source + selection rules

- Use `WorkspaceSettings.qualificationQuestions` (JSON string) as the library source.
- Decide whether stages store:
  - **IDs** (`qualificationQuestionIds String[] @default([])`) (recommended), or
  - raw question text (simpler but harder to keep consistent).
- Decide how to treat `required: true` questions:
  - always include when “includeQualifyingQuestions” is enabled, or
  - only include when explicitly selected at the stage.

### 4) Confirm “Booked” metric definition for MVP analytics

Choose one (document in plan + implement consistently):

- **Option A:** `Lead.sentimentTag === "Meeting Booked"` (proxy; fastest MVP)
- **Option B:** appointment evidence via `isMeetingBooked()` (more accurate when provider evidence exists)

### 5) Apply repo-reality patch notes to implementation steps

Ensure implementers do **not** accidentally build against non-existent fields:

- Campaign context for booking process must come from `Lead.emailCampaignId` (Message rows don’t store `emailCampaignId`).
- Qualification questions field is `qualificationQuestions` (not `qualifyingQuestions`).
- Booking link is resolved via `getBookingLink()` (CalendarLink default / Calendly event type link), not a WorkspaceSettings.calendarLink field.

### 6) Idempotency + counting strategy (avoid silent drift)

Before writing code in Phase 36b, decide one:

- **Option A (recommended):** Maintain a reply-count row updated transactionally when a new outbound `Message` row is created (counting becomes “Message insert = count increment”).
- **Option B:** Derive counts from `Message` table queries at runtime (simpler, but potentially slower; must define query predicates precisely).

If Option A, add an explicit idempotency rule (e.g., only increment after the outbound Message row is successfully created, and never increment on retries unless a new Message row exists).

## Output

- Root plan `Open Questions` answered (or reduced to a smaller set).
- A short “Implementation Patch Notes” section confirmed in the root plan (or updated) so subphases a–f aren’t implemented with stale assumptions.

## Handoff

Proceed with Phase 36a using the resolved semantics and patch notes (especially stage counting + booked definition).
