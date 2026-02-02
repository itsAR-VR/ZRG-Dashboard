# Phase 80 — AI Auto-Send Timing, "Meeting Booked" Draft Fix & Follow-Up Pause

## Purpose

Fix a bug where "Meeting Booked" leads don't get AI drafts, add configurable auto-send scheduling (24/7, business hours, custom), and centralize follow-up pause logic when meetings are booked.

## Context

**Investigation Trigger:** User reported that a lead (Ari Feingold, ari@propositionchicken.com) replied on Friday with specific meeting availability ("Friday the 20th, free after 12:30PM PST") but received no AI response.

### Root Cause Analysis

1. **Lead exists in two workspaces** — Todd's workspace (older lead, no inbound linked) and Chris's workspace (received inbound, marked `meeting-booked`)
2. **Inbound message processed successfully** — BackgroundJob `EMAIL_INBOUND_POST_PROCESS` completed
3. **No draft generated** — `shouldGenerateDraft()` in `lib/ai-drafts.ts:2450` returned `false`
4. **Why:** `POSITIVE_SENTIMENTS` array only includes `["Meeting Requested", "Call Requested", "Information Requested", "Interested"]` — **"Meeting Booked" is NOT in the list**

### Affected Lead

| Field | Value |
|-------|-------|
| Lead ID | `2ee904df-3d90-4b10-83ab-2571ecc0b46a` |
| Email | ari@propositionchicken.com |
| Status | meeting-booked |
| Last Inbound | Jan 30, 22:44 — "What about Friday the 20th? I'm free after 12:30PM PST" |
| Draft Created | ❌ None |

### User Requirements

1. **Bug Fix:** AI should generate drafts for "Meeting Booked" leads (they need scheduling help)
2. **Flexible Timing:** Configure when AI auto-send can fire (24/7, business hours, custom schedule)
3. **Meeting Pause:** Auto-pause/complete follow-up sequences when meeting is booked

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 79 | Uncommitted | `lib/ai-drafts.ts` (lead query + strategy) | Complete Phase 79 first OR merge carefully; both modify draft generation |
| Phase 81 | Uncommitted | `lib/auto-send/orchestrator.ts`, `prisma/schema.prisma`, `components/dashboard/settings-view.tsx` | Coordinate schema + orchestrator merges; both touch auto-send configuration |
| Phase 78 | Complete | None | Independent |
| Phase 77 | Complete | `lib/ai-drafts.ts` | Changes already committed |

## Objectives

* [x] Fix `shouldGenerateDraft()` to include "Meeting Booked" sentiment
* [x] Add `AutoSendScheduleMode` enum and fields to schema
* [x] Create `lib/auto-send-schedule.ts` with timing check logic
* [x] Integrate schedule checking into auto-send orchestrator
* [x] Centralize `pauseFollowUpsOnBooking()` in followup-engine.ts
* [x] Add UI controls for schedule mode (workspace + campaign level)
* [x] Verify with lint/build

## Constraints

- Maintain backward compatibility: Default to `ALWAYS` mode (current 24/7 behavior)
- Schedule reschedule (not skip): If outside window, delay to next valid window
- Per-campaign overrides: Campaign settings take precedence over workspace defaults
- Existing booking logic: Don't change what constitutes a "booking" — just centralize the pause trigger

## Success Criteria

- [x] "Meeting Booked" leads get AI drafts generated
- [x] Auto-send respects schedule mode when configured
- [x] Follow-up sequences complete when meeting is booked (via centralized function)
- [x] `npm run lint` passes
- [x] `npm run build` passes

## Key Files

| File | Change |
|------|--------|
| `lib/ai-drafts.ts` | Add "Meeting Booked" to `shouldGenerateDraft()` |
| `prisma/schema.prisma` | Add `AutoSendScheduleMode` enum, fields to WorkspaceSettings/EmailCampaign |
| `lib/auto-send-schedule.ts` | NEW — schedule checking utility |
| `lib/auto-send/orchestrator.ts` | Integrate schedule check before send |
| `lib/background-jobs/delayed-auto-send.ts` | Ensure scheduling supports both delay windows + fixed `runAt` (schedule gating) |
| `lib/followup-engine.ts` | Add `pauseFollowUpsOnBooking()` + `resumeFollowUpsOnBookingCanceled()` |
| `lib/booking.ts` | Replace inline follow-up completion with centralized call |
| `actions/booking-actions.ts` | Replace inline follow-up completion with centralized call |
| `lib/ghl-appointment-reconcile.ts` | Replace inline follow-up completion with centralized call |
| `lib/calendly-appointment-reconcile.ts` | Replace inline follow-up completion with centralized call |
| `app/api/webhooks/calendly/[clientId]/route.ts` | Replace inline follow-up completion with centralized call |
| `components/dashboard/settings-view.tsx` | Add schedule mode UI |
| `components/dashboard/settings/ai-campaign-assignment.tsx` | Add per-campaign schedule column |
| `lib/inbound-post-process/pipeline.ts` | Ensure AutoSendContext carries schedule settings (workspace + campaign) |

## Subphase Index

* a — Bug fix: "Meeting Booked" draft generation
* b — Schema: AutoSendScheduleMode enum and fields
* c — Library: auto-send-schedule.ts utility
* d — Integration: Orchestrator schedule check
* e — Centralize: pauseFollowUpsOnBooking consolidation
* f — UI: Schedule mode settings
* g — Hardening: schedule window + delay semantics
* h — Hardening: booking follow-up pause call-site audit
* i — Hardening: holidays + hybrid TZ + booking completion alignment

## Pre-Flight Conflict Check (Multi-Agent)

- [x] Ran `git status --porcelain` — no unexpected modifications to files in **Key Files**
- [x] Scanned Phases 79–81 for overlaps (drafting, schema, orchestrator, settings UI)
- [x] Confirmed Phase 80 changes are not blocked by Phase 79/81 merge order

## Repo Reality Check (RED TEAM)

- What exists today:
  - Auto-send uses `lib/auto-send/orchestrator.ts` + BackgroundJobType `AI_AUTO_SEND_DELAYED` (delayed execution).
  - Delayed auto-send scheduling/validation lives in `lib/background-jobs/delayed-auto-send.ts`; execution is `lib/background-jobs/ai-auto-send-delayed.ts`.
  - Follow-up completion-on-booking logic is currently duplicated across multiple booking paths (not just `lib/booking.ts`).
- What the plan assumes:
  - Arbitrary `runAt` scheduling via `scheduleDelayedAutoSend(...)` (not sufficient without a dedicated helper or extension).
  - Follow-up pause/complete logic only exists in 3 call sites (there are additional ones).
- Verified touch points:
  - `shouldGenerateDraft()` exists in `lib/ai-drafts.ts` and is the gate responsible for the missing-draft bug.
  - `AutoSendScheduleMode` exists in `prisma/schema.prisma` and needs plumbing through actions/UI.
  - `resolveAutoSendScheduleConfig()` + `isWithinAutoSendSchedule()` exist in `lib/auto-send-schedule.ts`.

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Schedule mode partially applied** → some paths still send immediately outside the configured window.
- **Delay window + schedule window interaction** → naive implementation can schedule a delayed send that lands outside the allowed window.
- **Follow-up pause not truly centralized** → missing call sites leads to inconsistent behavior (some booking paths still complete follow-ups inline).

### Missing or ambiguous requirements
- **Timezone choice for scheduling** (workspace vs lead timezone) → changes when sends are allowed.
- **Delay vs schedule precedence** → whether we preserve campaign delay jitter when outside schedule (or always “snap” to window start).
- **Follow-up behavior on booking** → should we *complete* vs *pause* sequences, and should cancellations/reschedules *resume* sequences?

### Repo mismatches (fix the plan)
- The delayed auto-send system needs an explicit way to schedule at a fixed `runAt` (next window) rather than only “delay seconds from inbound”.
- Booking follow-up completion logic also exists in `actions/booking-actions.ts` and `lib/calendly-appointment-reconcile.ts` (not listed in 80e).

### Security / permissions
- Schedule settings (especially CUSTOM JSON) should be **admin-gated** and validated server-side before persisting.

### Testing / validation
- Add unit tests for `lib/auto-send-schedule.ts` (business hours, weekends, overnight windows).
- Add orchestrator tests verifying:
  - outside-schedule → delayed schedule
  - within-schedule → immediate/normal delay behavior

## Open Questions (Need Human Input)

- [x] Should schedule enforcement use **workspace timezone** or **lead timezone**?
  - Why it matters: determines whether we avoid sending messages to leads at “bad hours”.
  - Decision: use workspace timezone (matches existing settings model).
- [x] When outside schedule, should we preserve the campaign’s **delay window jitter** or schedule exactly at the **next window start**?
  - Why it matters: impacts perceived “human-ness” and load spikes at window start.
  - Decision: schedule at the next window start; delay jitter still applies before schedule enforcement.
- [x] On booking, should we **complete** follow-up instances or **pause** them (with a reason) — and should cancellation **resume** them?
  - Why it matters: affects whether sequences can re-activate after meeting cancellations/reschedules.
  - Decision: complete follow-up instances on booking; do not resume on cancellation.

## Phase Summary

- Fixed draft gating by allowing "Meeting Booked" sentiment in `lib/ai-drafts.ts`.
- Added auto-send schedule configuration (schema fields + `lib/auto-send-schedule.ts`) and integrated schedule enforcement in the orchestrator and delayed job runner.
- Centralized booking follow-up completion on booking (no resume on cancellation), replacing inline logic across booking paths (GHL, Calendly webhook, booking actions, reconcile).
- Added holiday presets + blackout overrides and hybrid lead/workspace timezone resolution; admin-gated + validated schedule updates; updated workspace + campaign schedule UIs for holiday blackouts.
- Coordination: resolved a Prisma JSON write type in `actions/slack-integration-actions.ts` (overlap with Phase 81 Slack approval recipients work).
- Tests: schedule unit tests updated.
- Verified (2026-02-01):
  - `npm run lint`: pass (0 errors, 18 warnings)
  - `npm run build`: pass
  - `npm run db:push`: pass ("already in sync")
