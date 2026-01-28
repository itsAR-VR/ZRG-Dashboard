# Phase 62 — Direct Booking with Dual Link Support

## Purpose
Enable direct booking (we book them, they don't self-schedule) for all scenarios by supporting two booking links per provider: one with qualification questions and one without. The system intelligently routes based on whether the lead has answered qualification questions in the conversation.

## Context
**Definition:** Direct booking = We book them manually (not self-scheduling via link).

**The Problem:** Calendly event types (like Founders Club) can have required qualification questions. When we call `createCalendlyInvitee()` to book programmatically, the API fails if we don't pass answers to those required questions. Currently:
- Only one event type/calendar is configured per provider
- No tracking of lead's qualification answers
- Calendly API doesn't pass `questions_and_answers`
- Booking fails silently when questions are required

**Three Scenarios to Support:**

| Scenario | Lead Answered Questions? | Suggests Time? | Action |
|----------|-------------------------|----------------|--------|
| **1** | Yes | Says "yes" to offered time | Extract answers → Pass to booking API → Book using **questions-enabled** link |
| **2** | No | Says "yes" to offered time | Book using **no-questions** link |
| **3** | No | Proposes their own time | Parse their time → Book using **no-questions** link |

**Key Rule:** Whether they've answered questions or not → still direct book them. The only difference is whether we pass qualification data and which event type/calendar we use.

**Question Mapping:** Calendly/GHL have the **same questions** as ZRG's `WorkspaceSettings.qualificationQuestions`. This allows direct mapping without separate configuration.

## Clarification (2026-01-27)

For Calendly workspaces, we explicitly support **two Calendly event types** (same token / same team):

- **Link A (With Qualification Questions)**:
  - Used for **sending** the booking link in outbound messaging (AI drafts / follow-ups).
    - Outbound “send link” should be the **branded/public override** link when configured (expected: default `CalendarLink.publicUrl`), while the raw event-type link/URI remains the canonical booking target for API booking + mismatch tooling.
  - Used for **direct/API booking** only when qualification answers exist and are complete (we pass answers through).
- **Link B (No Qualification Questions)**:
  - Used for **direct/API booking** when qualification answers are missing (we skip qualification fields).

This means `Lead.preferredCalendarLinkId` is **not** the mechanism for picking A vs B; selection is driven by an AI + deterministic gating step at booking time (see Phase 62j).

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 64 | Active | `lib/ai-drafts.ts`, `prisma/schema.prisma` | Phase 64 modifies AI drafts + schema; avoid conflicts when rebasing/merging Phase 62 |
| Phase 63 | Active | `lib/ai/prompt-runner/*`, `prisma/schema.prisma`, `actions/settings-actions.ts` | Phase 63 modifies shared AI runner + schema/settings; rebase/merge before Phase 62 final validation |
| Phase 61 | Complete (uncommitted) | `prisma/schema.prisma`, `actions/settings-actions.ts` | Merge Phase 61 first; Phase 62 schema changes build on top |
| Phase 60 | Complete | `components/dashboard/settings-view.tsx` | Merge Phase 60 Settings UI changes first; Phase 62 extends the same Meeting Booking section |
| Phase 59 | Complete | None | Follow-up sequences; no booking overlap |
| Phase 52 | Complete | `lib/booking.ts` domain | Phase 52 established 5 booking processes; Phase 62 enhances direct booking within that framework |

## Pre-Flight Conflict Check (Multi-Agent)

- Working tree has Phase 61 changes to:
  - `actions/settings-actions.ts` (availability settings)
  - `prisma/schema.prisma` (Phase 61 says "no schema changes" but file is modified)
- Working tree has Phase 63 changes to:
  - `lib/ai/prompt-runner/*` (shared prompt runner used by answer extraction)
  - `prisma/schema.prisma`, `actions/settings-actions.ts` (shared)
- Working tree has Phase 64 changes to:
  - `lib/ai-drafts.ts` (independent of booking, but overlaps on shared AI + lead fetch patterns)
- Working tree has Phase 60 changes to:
  - `components/dashboard/settings-view.tsx` (Booking UI reference panel + meeting booking section)
- Files this phase will touch:
  - `prisma/schema.prisma` — Add Lead.qualificationAnswers and WorkspaceSettings.*DirectBook* fields
  - `lib/qualification-answer-extraction.ts` — **NEW** AI-powered answer extraction
  - `lib/booking.ts` — Dual link routing logic
  - `lib/calendly-api.ts` — Add questions_and_answers parameter
  - `lib/followup-engine.ts` — Ensure extraction runs **before** booking attempt (shared auto-book entrypoint)
  - `components/dashboard/settings-view.tsx` — Dual booking link UI
  - `actions/settings-actions.ts` — Save dual booking link settings (via `updateUserSettings()`)
- **Coordination requirement:** Rebase/merge Phase 61 + Phase 63 before Phase 62 final QA (`lint/build/test`) to avoid schema/settings/prompt-runner drift

## Objectives
* [x] Add `Lead.qualificationAnswers` field to track extracted answers from conversation
* [x] Add dual booking link settings: `WorkspaceSettings.calendlyDirectBookEventTypeLink/Uri` and `ghlDirectBookCalendarId`
* [x] Create AI-powered qualification answer extraction from conversation transcripts
* [x] Update booking logic to route based on **required-answer completeness** (not just “any answer”)
* [x] Update Calendly API to pass `questions_and_answers` when available
* [x] Update Settings UI with dual booking link configuration
* [x] Add an AI “booking target selector” step (A vs B) so booking link selection isn’t inferred from lead calendar overrides (matches latest product intent)
* [x] Add dual availability-source support (A/B) so offered slots and booking targets cannot drift
* [ ] Ensure all three scenarios result in successful direct booking (end-to-end QA) — pending live smoke tests against real Calendly/GHL accounts

## Constraints
- Preserve existing auto-booking flow (`processMessageForAutoBooking()`)
- Same question text used across ZRG, Calendly, and GHL (no mapping needed)
- Must work with both GHL and Calendly providers
- Answer extraction must be **bounded** (timeouts + gating) and must not create webhook timeout risk
- Extraction should use “questions that were actually asked” (e.g., `LeadCampaignBookingProgress.selectedRequiredQuestionIds`) to reduce hallucinations
- No changes to existing booking process wave tracking (Phase 36)
- Backward compatible: workspaces without direct-book link fall back to single-link behavior

## Decisions (Locked)
- Scope: Link A / Link B configuration is **client-scoped** (stored on `WorkspaceSettings` keyed by `clientId = Client.id`). It is **not** shared across multiple clients, even if multiple clients belong to the same “white-label workspace” / owner user. (locked 2026-01-27)
- Scenario 3 availability matching: **exact slot match only** (no tolerance window).
- Scenario 3 auto-book confidence threshold: `>= 0.9` (with deterministic gates).
- Qualification answer extraction confidence threshold: `>= 0.7` (used for routing + Calendly payload construction).
- Availability caches are stored per client **and** per source (`DEFAULT` vs `DIRECT_BOOK`) using a composite unique key `(clientId, availabilitySource)` (Phase 62j locked 2026-01-27).
- Slot offer distribution counts are stored per client **and** per source using `(clientId, availabilitySource, slotUtc)` to prevent A/B mixing (Phase 62j locked 2026-01-27).
- `Lead.offeredSlots` remains JSON text, but each slot record will include `availabilitySource` for mismatch-safe booking (Phase 62j locked 2026-01-27).

## Success Criteria
- [ ] Lead with **all required** qualification answers → books using questions-enabled link with answers passed (implemented in `lib/booking.ts`; needs live Calendly smoke test)
- [ ] Lead with **partial** qualification answers → books using direct-book link/calendar (no questions) with a warning log + follow-up task if booking fails (implemented in `lib/booking.ts`; needs live smoke test)
- [ ] Lead without qualification answers → books using direct-book link (no questions) (implemented in `lib/booking.ts`; needs live smoke test)
- [ ] Lead proposing their own time (no prior questions) → books using direct-book link (implemented in `lib/followup-engine.ts`; needs live smoke test)
- [x] Calendly invitee payload includes `questions_and_answers` with `position` (unit test)
- [ ] Settings UI allows configuring both booking links per provider (implemented; needs UI smoke test + persistence verification)
- [x] Availability slots are sourced from the same booking target (A or B) that we will use to book (implemented via `AvailabilitySource`; needs live smoke test)
- [x] AI booking target selector returns a valid choice (A or B) with bounded tokens/timeouts and safe fallbacks when incomplete (implemented; needs live smoke test)
- [x] `npm run lint` passes
- [x] `npm run build` passes
- [x] `npm run db:push` completes successfully (ran with `-- --accept-data-loss` after verifying no duplicates for new unique constraints)
- [x] `npm test` passes

## Subphase Index
* a — Schema: Add Lead.qualificationAnswers and dual booking link settings
* b — Answer Extraction: Create AI-powered extraction from conversation
* c — Booking Routing: Update booking logic for dual link selection
* d — Calendly API: Add questions_and_answers parameter
* e — Settings UI: Dual booking link configuration
* f — Integration: Wire extraction into inbound pipeline + testing
* g — Hardening: required-answer completeness + ensure extraction runs before booking across all entrypoints
* h — Scenario 3: lead-proposed time auto-booking (no offered slots) + safety fallbacks
* i — Plan Updates: Calendly docs confirmed (position required) + Scenario 3 auto-book decision + JSON schema choice
* j — Availability + AI Selector: dual availability sources + AI booking target selection (A vs B)

## Repo Reality Check (RED TEAM)

### What exists today
- `prisma/schema.prisma`:
  - `Lead.qualificationAnswers` is `Json?` + `qualificationAnswersExtractedAt`
  - `WorkspaceSettings` includes `calendlyDirectBookEventTypeLink/Uri` + `ghlDirectBookCalendarId`
- `lib/qualification-answer-extraction.ts` (**NEW**):
  - Extracts answers from recent message transcripts into `Lead.qualificationAnswers` (confidence-scored)
  - Extraction targets the asked required questions (`LeadCampaignBookingProgress.selectedRequiredQuestionIds`) to reduce hallucination risk
  - Provides a readiness state (`hasAllRequiredAnswers`, `missingRequiredQuestionIds`, `answers`)
- `lib/booking.ts`:
  - `bookMeetingOnCalendly()`:
    - runs extract-if-needed before selecting event type
    - resolves both event type URIs (questions-enabled + direct-book) from links and caches to `WorkspaceSettings`
    - routes to questions-enabled booking only when **all required answers are available**
    - maps workspace questions → Calendly `custom_questions[].position` via event type fetch
    - retries direct-book booking if questions-enabled booking fails and direct-book is configured
  - `bookMeetingForLead()` (GHL):
    - prefers `ghlDirectBookCalendarId` when required answers are incomplete
- `lib/calendly-api.ts`:
  - `createCalendlyInvitee()` supports `questionsAndAnswers` and sends `questions_and_answers`
  - `getCalendlyEventType()` fetches `custom_questions[]` for `name/position/required` mapping
- `lib/followup-engine.ts`:
  - `processMessageForAutoBooking()` includes Scenario 3 (lead-proposed time) with confidence + availability intersection gating
- `actions/settings-actions.ts` + `components/dashboard/settings-view.tsx`:
  - Persist + configure direct-book settings for both providers

### What this plan assumes
- Calendly API `POST /invitees` supports `questions_and_answers` as `{ question: string, answer: string, position: number }[]`
- GHL calendar without questions can be configured as a separate calendar
- AI can reliably extract answers from conversation transcript
- Question text is identical between ZRG and Calendly/GHL (confirmed by user)

### Verified touch points (files + identifiers)
- `lib/booking.ts`: `bookMeetingForLead()`, `bookMeetingOnCalendly()`, `bookMeetingOnGHL()`
- `lib/calendly-api.ts`: `createCalendlyInvitee()`
- `lib/inbound-post-process/pipeline.ts`: `runInboundPostProcessPipeline()`
- `lib/followup-engine.ts`: `processMessageForAutoBooking()`
- `prisma/schema.prisma`: `Lead`, `WorkspaceSettings`
- `components/dashboard/settings-view.tsx`: Booking settings section
- `actions/settings-actions.ts`: `updateUserSettings()`

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Question text mismatch / missing Calendly `position` mapping** → required answers exist but payload can't be constructed → ensure event type `custom_questions` are fetched and mapping failures degrade to direct-book booking + follow-up task
- **Scenario 3 time parsing ambiguity** → accidental booking at wrong time → require deterministic gates (timezone known + exact availability intersection) and a high confidence threshold; otherwise create a follow-up task
- **AI extraction hallucination** → wrong answers passed to Calendly → restrict extraction targets to asked-required questions + require confidence threshold; fall back to direct-book if answers are uncertain
- **Calendly create-invitee rate limits** → booking bursts can hit 429s → add per-workspace throttling/backoff; on 429, retry once with jitter or degrade to follow-up task
- **Multi-agent drift** (Phase 63/64) → prompt runner/schema changes break extraction/booking at runtime → rebase/merge before final QA and re-run validations

### Missing requirements
- Define “answered questions” as **all required answered with confidence ≥ threshold** (not “any”), and document the threshold/behavior.
- Explicitly document the fallback matrix when only one of the two booking targets is configured (questions-enabled vs direct-book).
- Add explicit “no PII” logging guidance for extracted answers and Calendly payload construction failures.

### Testing / validation
- Manual test all three scenarios
- Verify Calendly API accepts the question format
- Test fallback when direct-book link not configured
- Add at least one targeted unit test for “required-answer completeness → link selection” to prevent regressions

## Open Questions (Need Human Input)
- None (resolved 2026-01-27)

## Assumptions (Agent)
- Calendly `questions_and_answers` is `[{ question: string, answer: string, position: number }]` and the API expects **question text** (not question IDs). (confidence ~95%)
  - Mitigation: Use `GET /event_types` (or equivalent) to map `custom_questions[].name` → `position` to avoid “position mismatch” failures; retry/fallback to direct-book event type on 4xx.
- GHL direct-book calendar doesn't require special configuration beyond calendar ID (confidence ~90%)
  - Mitigation: If GHL requires question passing, implement similar to Calendly
- Workspaces will configure both links or only the questions-enabled link (confidence ~90%)
  - Mitigation: Fall back to single-link behavior if direct-book link not configured
- Scenario 3 should **auto-book** when: timezone known, parsing confidence is high, and the proposed time intersects current availability; otherwise create a follow-up task (confidence ~90%)
  - Mitigation: Treat model confidence as advisory; also require deterministic availability intersection and strict gating to prevent accidental bookings.
- `Lead.qualificationAnswers` should be stored as `Json?` (JSONB) for safer parsing and easier backfills/querying (confidence ~90%)
  - Mitigation: If Prisma JSON ergonomics become painful, fall back to JSON-as-text with a single helper for parsing/serialization.

## Phase Summary

**Status:** ✅ Implemented (pending live smoke tests)

### What Was Done
- **Schema (62a):** Added `Lead.qualificationAnswers` (Json?) and `Lead.qualificationAnswersExtractedAt` for tracking extracted answers. Added `WorkspaceSettings.calendlyDirectBookEventTypeLink/Uri` and `ghlDirectBookCalendarId` for dual booking links.
- **Answer Extraction (62b):** Created `lib/qualification-answer-extraction.ts` with AI-powered extraction from conversation transcripts. Uses confidence scoring (≥0.7 threshold) and targets only asked required questions to reduce hallucination.
- **Booking Routing (62c):** Updated `lib/booking.ts` with dual link routing based on "all required answers complete" (not just "any answers"). Includes fallback retry to direct-book link on questions-enabled failure.
- **Calendly API (62d):** Updated `createCalendlyInvitee()` to accept `questionsAndAnswers` with `position` field. Added `getCalendlyEventType()` for fetching `custom_questions[]` mapping.
- **Settings UI (62e):** Added dual booking link configuration for both GHL and Calendly in `components/dashboard/settings-view.tsx`.
- **Integration (62f):** Wired extraction into booking flow to run before link selection.
- **Hardening (62g-h):** Ensured required-answer completeness gates booking, Scenario 3 lead-proposed times use direct-book link with availability intersection gating.
- **Plan Updates (62i):** Confirmed Calendly `questions_and_answers` schema requires `position`, locked decision to use Json? for storage.
- **Availability + AI Selector (62j):** Added `AvailabilitySource` and dual availability caches (`DEFAULT`/`DIRECT_BOOK`) so offered slots and booking targets cannot drift. Added AI booking-target selection (A vs B) with deterministic fallbacks.
- **Outbound Send Link Override:** `lib/meeting-booking-provider.ts:resolveBookingLink()` now uses the default `CalendarLink.publicUrl` when configured for Calendly (branded/public outbound link), otherwise falls back to the raw event-type link.

### Key Decisions
1. **"All required answered" gating:** Questions-enabled booking only when ALL required answers are complete with confidence ≥0.7
2. **Position mapping:** Calendly `custom_questions[].position` fetched via event type API and mapped by normalized question text
3. **Graceful degradation:** Retry with direct-book link if questions-enabled fails; explicit error if no fallback available
4. **Offer/booking consistency:** Offered slots include `availabilitySource` and booking uses the same source to avoid A/B drift

### Artifacts
- `lib/qualification-answer-extraction.ts` — NEW module
- `lib/booking-target-selector.ts` — NEW module
- `lib/meeting-booking-provider.ts` — Calendly branded/public outbound booking link override
- `lib/__tests__/calendly-invitee-questions.test.ts` — Unit tests for Calendly Q&A
- Schema fields: `Lead.qualificationAnswers`, `WorkspaceSettings.calendlyDirectBookEventTypeLink/Uri`, `ghlDirectBookCalendarId`
- Schema additions: `AvailabilitySource`, `WorkspaceAvailabilityCache.availabilitySource`, `WorkspaceOfferedSlot.availabilitySource`
- `lib/availability-cache.ts` — Dual-source availability cache support
- `lib/slot-offer-ledger.ts` — Source-aware offer counts
- `app/api/cron/availability/route.ts` — Refresh both sources

### Verification (2026-01-28)
- `npm run lint`: ✅ pass (warnings only, no errors)
- `npm run build`: ✅ pass
- DB de-dupe check (pre-constraint): ✅ no duplicates found for:
  - `WorkspaceAvailabilityCache(clientId)`
  - `WorkspaceOfferedSlot(clientId, slotUtc)`
- `npm run db:push -- --accept-data-loss`: ✅ pass (unique constraints applied)
- `npm test`: ✅ pass (51 tests)

### Follow-up Items (Optional)
- Add UI indicator showing which questions the lead has answered
- Add manual answer editing capability in CRM view
- Add analytics on answer extraction success rate
- Support for GHL custom fields (if they have an equivalent to Calendly questions)
