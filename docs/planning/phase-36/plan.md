# Phase 36 — Booking Process Selection Per Campaign

## Purpose

Enable users to create reusable booking processes that define when and how the AI offers booking slots, links, and qualifying questions — then assign these processes to campaigns for A/B testing and optimization across different industries and lead types.

## Context

Different industries and lead types respond better to different booking approaches:

- **SaaS/Tech**: Prefer direct booking links immediately
- **Local Services**: Prefer suggested times with human feel, no immediate link
- **Cold Leads**: Need relationship building before asking for commitment

Currently, the AI drafts use a one-size-fits-all approach. The follow-up sequencing system already supports multi-channel waves (SMS + Email per stage), and this booking process feature will follow a similar pattern — controlling what the AI includes in each reply stage.

**Key quotes from stakeholder meeting:**

> "Different niches will have different impacts. Like, for example, I know for a fact that if you're in SaaS, people actually like, prefer, like a booking link... Whereas if you're an FB ads agency for a local service business, they prefer saying yes to two different times."

> "We need to figure out how to give the option for people to select what type of booking process they have."

> "It needs to be per campaign, because then what we could do is have exactly the same campaign copy for each one. It's just got a different booking process, so you can test them side by side."

**Clarified design decisions:**

1. **Reply tracking**: Stage numbers are a **global wave index shared across channels**. A wave can include up to one outbound per channel (SMS may split into up to 3 parts); wave advances only after all stage-enabled channels have been sent (or explicitly skipped due to channel unavailability).
2. **Wave model**: A booking process stage can trigger actions across multiple channels (like follow-up sequences)
3. **Auto-booking unchanged**: Booking process controls when slots are offered; existing auto-booking fires on acceptance
4. **Show rate proxy**: No reliable attendance tracking yet → treat verified booking as “completed” for MVP analytics (aligns with Phase 28 meeting lifecycle semantics).
   - “Booked” should be provider-evidence-backed (status/provider IDs); `sentimentTag === "Meeting Booked"` is expected to align with evidence.
5. **Qualifying questions**: Source from `WorkspaceSettings.qualificationQuestions`; when a stage enables questions, **always include `required: true` questions as well** (SMS caps to max **2 required**; rotate if more exist; SMS may paraphrase to fit).
6. **Calendar link**: Use existing booking link resolution (`lib/meeting-booking-provider.ts:getBookingLink()`), and **always use the workspace default link** when inserting booking links (ignore per-lead calendar overrides).
7. **Draft integration**: Inject booking process instructions into AI prompt
8. **SMS constraint**: SMS output must be **strict ≤ 160 characters** even when including links/times/questions.
9. **SMS multipart**: When stage requirements can’t fit in one SMS, the AI may draft up to **3 SMS parts**, each **≤160**, and we send them sequentially (still within the same wave/channel send).
   - Priority when splitting: include **times + booking link** first; then required questions; then optional items.
10. **Channel unavailability**: If a stage applies to SMS but a lead has **no phone number**, we **skip SMS for that lead and advance the wave**.
11. **SMS DND handling**: If SMS is blocked by GHL DND (`sendSmsSystem` → `errorCode: "sms_dnd"` / `Lead.smsDndActive === true`), we **hold the wave and retry until DND clears** (do not skip/advance).
12. **SMS DND retry schedule**: Retry SMS send every **2 hours** while the wave is held for DND. If DND blocks SMS for **>72 hours** in a row, stop holding and **treat SMS as skipped for that wave** so the wave can advance.
13. **No process assigned ("None / Manual")**: Use **current behavior** (no stage enforcement; normal draft generation continues as today).

## Objectives

* [x] Create data model for BookingProcess, stages, and reply tracking
* [x] Build booking wave progress per-lead/per-campaign (global wave) + per-channel outbound counts
* [x] Implement booking process builder UI (CRUD)
* [x] Add campaign assignment UI and persistence
* [x] Integrate booking process rules into AI draft generation
* [x] Build analytics comparing booking process effectiveness

## Constraints

- Must integrate with existing `EmailCampaign` model (already synced from EmailBison)
- Stage counter must be global wave index shared across channels
- Existing `processMessageForAutoBooking()` slot-matching logic remains unchanged
- Qualifying questions pulled from `WorkspaceSettings.qualificationQuestions` (AI personality settings)
- SMS includes max **2** required questions; if more required questions exist, rotate/cycle for experimentation (and track which IDs were used)
- Booking link is resolved via `lib/meeting-booking-provider.ts:getBookingLink()` (CalendarLink default or Calendly event type)
- Booking links inserted by booking process must use the workspace default booking link (no per-lead override)
- SMS parts must remain ≤160 chars (hard limit); allow up to 3 parts when needed
- SMS DND must **hold/retry** until cleared (do not advance the wave)
- Analytics must support per-campaign + per-booking-process breakdowns

## Success Criteria

- [x] User can create a booking process with multiple stages, each configuring: booking link, suggested times, qualifying questions, timezone ask
- [x] User can assign a booking process to any synced campaign
- [x] AI drafts respect booking process rules based on current wave stage for that lead/campaign/channel
- [x] Analytics show metrics (booked rate, avg replies to book) filterable by booking process
- [x] A/B testing scenario works: same copy, different booking process, compare results

> NOTE (RED TEAM): Subphase `g` is a preflight check to reconcile plan assumptions with repo reality and lock down remaining semantics before implementation.

## Subphase Index

* a — Data Model & Schema
* b — Reply Counter Implementation
* c — Booking Process Builder UI
* d — Campaign Assignment
* e — AI Draft Integration
* f — Analytics & Tracking
* g — RED TEAM Fixups (Preflight)
* h — Implementation Addendum (Wave Semantics + SMS 160)
* i — SMS Multipart Addendum (≤160 per part)

## Repo Reality Check (RED TEAM)

- What exists today:
  - Campaigns are persisted as `EmailCampaign` rows (already used for per-campaign settings like `responseMode` and `autoSendConfidenceThreshold`).
  - Leads link to campaigns via `Lead.emailCampaignId` (Message rows do not store `emailCampaignId`).
  - Qualification questions are stored in `WorkspaceSettings.qualificationQuestions` (JSON string) and are already parsed/used by `lib/ai-drafts.ts` + `lib/followup-engine.ts`.
  - Booking links are resolved via `lib/meeting-booking-provider.ts:getBookingLink()` and calendar URLs live in `CalendarLink` (default per workspace). Leads can override via `Lead.preferredCalendarLinkId` (exists today), but booking process insertion will use the workspace default link only.
  - Draft generation already has availability + offered-slots plumbing (`getWorkspaceAvailabilitySlotsUtc` + `selectDistributedAvailabilitySlots` + `formatAvailabilitySlots`) and persists `Lead.offeredSlots`.
  - Follow-up sequencing currently treats SMS DND as non-retriable and skips the step (`lib/followup-engine.ts`) — booking process waves will differ (hold/retry).
  - Existing campaign configuration UI lives at `components/dashboard/settings/ai-campaign-assignment.tsx` (good insertion point for “Booking Process” dropdown).
- What this plan assumes:
  - A booking process is assigned per `EmailCampaign` and should influence omni-channel outbound behavior (email/SMS/LinkedIn).
  - “Stages” map onto a **global wave index shared across channels** (see `docs/planning/phase-36/h/plan.md`).
  - Wave progress increments only for outbound messages we send from this system (i.e., `Message.direction === "outbound"` and `Message.source === "zrg"`), not for campaign-sent messages (`source !== "zrg"`) or inbound messages.
- Verified touch points (paths + identifiers confirmed in repo):
  - `prisma/schema.prisma` (`EmailCampaign`, `Lead.emailCampaignId`, `WorkspaceSettings.qualificationQuestions`, `CalendarLink`, `Lead.preferredCalendarLinkId`)
  - `lib/ai-drafts.ts:generateResponseDraft`
  - `lib/meeting-booking-provider.ts:getBookingLink`, `lib/meeting-booking-provider.ts:isMeetingBooked`
  - `lib/meeting-lifecycle.ts:isMeetingVerifiedBooked`
  - `lib/availability-cache.ts:getWorkspaceAvailabilitySlotsUtc`
  - `lib/followup-engine.ts:generateFollowUpMessage`, `lib/followup-engine.ts:processMessageForAutoBooking`
  - `actions/email-campaign-actions.ts:updateEmailCampaignConfig`, `components/dashboard/settings/ai-campaign-assignment.tsx`

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Stage counter semantics wrong → booking content appears at the wrong time/channel → deliverability + conversion regressions.
- Prompt conflicts (existing “SCHEDULING RULES” + always-availability behavior) override booking process instructions → feature appears “broken”.
- Reply count double-increments on retries/background jobs → stages advance too fast → analytics wrong.
- Multipart SMS not modeled → drafts can’t be approved/sent cleanly (schema + UI mismatch) → feature ships half-broken. (Resolved: multipart SMS implemented end-to-end.)

### Missing or ambiguous requirements
- Define the SMS multipart contract (max 3 parts) and how we persist/approve/send it. (Resolved)
- Define how required-question rotation is attributed for analytics (store the chosen required-question IDs per lead/campaign/wave). (Resolved)

### Repo mismatches (fix the plan)
- “WorkspaceSettings.calendarLink” does not exist; use `getBookingLink()` + workspace default `CalendarLink` (booking process insertion ignores per-lead overrides).
- Workspace setting is `qualificationQuestions`, not `qualifyingQuestions`.
- Lead “sentiment” is stored as `Lead.sentimentTag` (string categories like “Meeting Booked”), and meeting evidence exists via `isMeetingBooked()`.
- Messages do not store `emailCampaignId`; campaign context must come from `Lead.emailCampaignId` (or other campaign fields when relevant).
- Subphases `a/b/d/e/f` describe an older per-channel reply-counter approach; follow `docs/planning/phase-36/h/plan.md` (waves + attribution) and `docs/planning/phase-36/i/plan.md` (SMS multipart) as the source of truth.

### Performance / timeouts
- Avoid per-draft extra DB roundtrips; prefer fetching campaign+booking process as part of the existing lead/settings query where possible.
- Any new “instructions builder” must be deterministic and lightweight; do not fetch availability unless the current stage requires it.

### Security / permissions
- Booking process CRUD + campaign assignment should be workspace-admin gated (use existing `requireClientAdminAccess` patterns).

### Testing / validation
- Add explicit validation steps for: stage selection correctness, prompt override correctness, idempotent reply counting, and analytics correctness (booked definition).

## Open Questions (Need Human Input)

- None.

## Assumptions (Agent)

- Campaign assignment UI will extend `components/dashboard/settings/ai-campaign-assignment.tsx` (confidence >=90%)
  - Mitigation check: if campaigns are assigned elsewhere in the inbox UI, place the dropdown there instead and keep the same action wiring.

## Phase Summary

- Shipped:
  - Prisma models + relations for booking processes and wave tracking (`prisma/schema.prisma`)
  - Booking process CRUD actions + templates (`actions/booking-process-actions.ts`, `lib/booking-process-templates.ts`)
  - Booking process builder UI (`components/dashboard/settings/booking-process-manager.tsx`, `components/dashboard/settings-view.tsx`)
  - Per-campaign booking process assignment (`actions/email-campaign-actions.ts`, `components/dashboard/settings/ai-campaign-assignment.tsx`)
  - Booking-process instruction injection into drafts (`lib/booking-process-instructions.ts`, `lib/ai-drafts.ts`)
  - Booking process analytics queries + UI (partial) (`actions/booking-process-analytics-actions.ts`, `components/dashboard/settings/booking-process-analytics.tsx`)
- Verified (2026-01-18):
  - `npm run lint`: pass (warnings only)
  - `npm run build`: pass (Next.js warnings: multiple lockfiles + middleware deprecation)
  - `npm run db:push`: pass (“The database is already in sync with the Prisma schema.”)
- Notes / gaps:
  - Multipart SMS (1–3 parts, ≤160 chars/part) is implemented end-to-end (`lib/sms-multipart.ts`, `actions/message-actions.ts:approveAndSendDraftSystem`, `lib/system-sender.ts`).
  - SMS length enforcement is deterministic at send-time (validator + fallback splitter) via `lib/sms-multipart.ts`.
