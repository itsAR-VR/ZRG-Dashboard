# Phase 88 — Analytics: Workflow vs Initial Bookings + Reactivation KPIs (Consolidate Analytics Tab)

## Purpose
Add analytics that attribute bookings to either the initial response or follow-up workflows (sequences), add reactivation campaign performance analytics, and ensure **all** analytics surfaces live only in the **Analytics** tab (including moving booking analytics out of Settings/Bookings).

## Context
- The dashboard already has an Analytics surface (`components/dashboard/analytics-view.tsx`) and existing analytics actions (`actions/analytics-actions.ts`).
- Follow-up sequences are represented by `FollowUpInstance` + `FollowUpStep` and execution writes `FollowUpTask` rows (per step) plus outbound `Message` rows (`lib/followup-engine.ts`).
- Reactivation campaigns already exist (`ReactivationCampaign`, `ReactivationEnrollment`, `ReactivationSendLog`) and reactivation sends create outbound `Message` rows (`lib/reactivation-engine.ts`).
- Current UX problem: analytics are spread across multiple areas (e.g., booking process analytics lives under Settings → Booking). The requirement is: **only** Analytics tab should show analytics.
- Product need:
  - Workflow performance: "how many get booked from workflows vs booked from initial response" (follow-up workflows/sequences).
  - Reactivation performance: "how many meetings", plus response rate and other KPIs for reactivation campaigns.
  - Analytics should support switching time windows via a date selector (default: last 30 days).

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 83 | Uncommitted (working tree) | `actions/analytics-actions.ts`, `components/dashboard/analytics-view.tsx`, `components/dashboard/analytics-crm-table.tsx` | Treat Analytics files as unstable until Phase 83 is merged; re-read current file state before implementing Phase 88 and merge semantically (do not overwrite CRM analytics work). |
| Phase 80 | Uncommitted (working tree) | `components/dashboard/settings-view.tsx` | Phase 88 will remove/move booking analytics from Settings; coordinate/merge carefully with any Settings UI edits from Phase 80. |
| Phase 81 | Uncommitted (working tree) | `components/dashboard/settings-view.tsx` | Same as Phase 80; avoid clobbering Slack/auto-send UI changes. |
| Phase 86 | Untracked (working tree) | `components/dashboard/settings-view.tsx` | If Phase 86 adds Booking-related Settings UI, ensure Phase 88 changes are limited to removing analytics-only sections (move them to Analytics). |

## Objectives
* [ ] Define attribution + KPI rules for workflow bookings and reactivation campaigns (decision-complete).
* [ ] Implement backend analytics queries that respect a selected date window and workspace scoping.
* [ ] Update Analytics tab UI to include the new sections and a working date range selector.
* [ ] Move booking-related analytics currently in Settings/Bookings into the Analytics tab and remove analytics duplication elsewhere.
* [ ] Validate with lint/build and smoke-test key scenarios.

## Constraints
- **Single source of analytics UI:** analytics must appear only in the Analytics tab (sidebar "Analytics" view).
- **Default window:** last 30 days, with ability to switch windows dynamically via a date selector.
- **Attribution rule (workflow vs initial):**
  - "Booked from initial response" = booked before any follow-up step was sent.
  - "Booked from workflow" = booked after ≥1 follow-up step was sent.
- **Reactivation response definition:** any inbound message after bump send (any channel).
- **Auth + multi-tenant:** analytics must enforce workspace access using existing access filters; no cross-workspace leakage.
- **Performance:** use efficient queries (prefer SQL aggregation where needed); avoid N+1 over leads.
- **No secrets/PII:** do not log or persist sensitive data beyond existing models.

## Success Criteria
- [x] Analytics tab shows:
  - Workflow attribution (initial vs workflow) and updates when the date window changes.
  - Reactivation campaign KPIs (sent, responded, response rate, meetings booked, booking rate) and updates when the date window changes.
  - Booking process analytics (moved from Settings) and only appears under Analytics.
- [x] Settings/Bookings no longer contains analytics-only panels (no duplicate analytics).
- [x] Date selector works end-to-end without page refresh and without breaking existing Analytics overview/CRM views (code verified; manual testing pending).
- [x] Validation passes: `npm run lint`, `npm run build` (see Phase 88 review.md).

## Phase Summary

**What shipped**
- Window-aware analytics in `actions/analytics-actions.ts` plus new workflow + reactivation analytics actions.
- Analytics UI now includes tabs: Overview, Workflows, Campaigns, Booking, CRM with a working date selector.
- Booking analytics moved from Settings into Analytics (Booking tab).

**Key decisions**
- Workflow attribution uses the earliest `FollowUpInstance.lastStepAt` before booking.
- Reactivation response = any inbound after bump (cross-channel).
- Date selector presets: 7/30/90 + custom range (no “all time” preset).

**Files touched**
- `actions/analytics-actions.ts`
- `components/dashboard/analytics-view.tsx`
- `components/dashboard/settings-view.tsx`

**Verification status**
- `npm run lint` passes (23 warnings, 0 errors).
- `npm run build` passes (fixed unrelated script type error; `CrmSheetRow` issue was stale cache).
- See `docs/planning/phase-88/review.md` for full verification details.

## Repo Reality Check (RED TEAM)

### What exists today
- **Analytics UI:** `components/dashboard/analytics-view.tsx` has tabbed layout (Overview, CRM) per Phase 83
- **Analytics actions:** `actions/analytics-actions.ts` exports `getAnalytics()`, `getEmailCampaignAnalytics()`, `getSetterFunnelAnalytics()`, `getCrmSheetRows()` with window support via `{ from, to }` params
- **Analytics cache:** In-memory cache with 5-minute TTL keyed by `{userId}:{clientId}` in `analytics-actions.ts`
- **Booking analytics:** `components/dashboard/settings/booking-process-analytics.tsx` (currently rendered in Settings)
- **Booking analytics actions:** `actions/booking-process-analytics-actions.ts` exports `getBookingProcessMetrics()`, `getBookingProcessSummary()`
- **Follow-up models:**
  - `FollowUpSequence` — template definitions per client
  - `FollowUpStep` — individual steps within a sequence
  - `FollowUpInstance` — per-lead enrollment with `currentStep`, `status`, `lastStepAt`
  - `FollowUpTask` — task rows created when steps execute (has `instanceId`, `stepOrder`, `status`)
- **Reactivation models:**
  - `ReactivationCampaign` — campaign definition with `bumpMessageTemplate`, `followUpSequenceId`
  - `ReactivationEnrollment` — per-lead enrollment with `status` (pending_resolution | ready | sent | rate_limited | needs_review | failed), `sentAt`
  - `ReactivationSendLog` — send history with `stepKey`, `sentAt`, `status`
- **Booking signals on Lead:** `appointmentBookedAt`, `ghlAppointmentId`, `calendlyInviteeUri`, `calendlyScheduledEventUri`

### Verified touch points
- `actions/analytics-actions.ts:408` — `getAnalytics()` with window support via `{ from, to }`
- `actions/analytics-actions.ts:875` — `getEmailCampaignAnalytics()` with window support
- `components/dashboard/analytics-view.tsx:154` — Tabs component with Overview/CRM
- `components/dashboard/settings/booking-process-analytics.tsx:46` — `BookingProcessAnalytics` component
- `lib/followup-engine.ts:1` — Follow-up step execution
- `lib/reactivation-engine.ts:716` — `processReactivationSendsDue()` creates Message rows
- `prisma/schema.prisma:1133` — `FollowUpInstance` model
- `prisma/schema.prisma:1189` — `ReactivationEnrollment` model

### Plan corrections from repo check
1. **FollowUpTask clarification:** `FollowUpTask` represents a scheduled/executed task, not just execution tracking. The `instanceId` + `stepOrder` fields link tasks to sequence execution. However, the more reliable attribution signal is `FollowUpInstance.lastStepAt` (non-null = at least one step executed).
2. **Cache key semantics:** Analytics cache is user-scoped (`{userId}:{clientId}`), so window parameters must be incorporated into cache keys to avoid stale windowed data.
3. **Existing window support:** `getEmailCampaignAnalytics` already accepts `{ from, to }` parameters, so the pattern is established.

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Workflow attribution query performance:** Joining Lead → FollowUpInstance → FollowUpTask for every booked lead could be slow for large workspaces → Mitigation: Use aggregation queries with CTEs; add index on `FollowUpInstance.lastStepAt` if missing.
- **Reactivation response detection timing:** "Inbound after bump" requires comparing `Message.sentAt` with `ReactivationEnrollment.sentAt` per lead; misaligned clocks could misattribute → Mitigation: Use ≥ comparison with small buffer (1 minute) or use enrollment window boundary.
- **Cache key collision with windows:** Current cache key is `{userId}:{clientId}` which doesn't include window bounds; adding windowed analytics could return stale data → Mitigation: Incorporate window hash into cache key or use separate cache map for windowed queries.

### Missing or ambiguous requirements
- **"Booked from workflow" definition ambiguity:** Should count leads booked during an active instance, or any lead that ever had a follow-up step sent? → Current assumption: Any lead with `FollowUpInstance` where `lastStepAt < appointmentBookedAt`.
- **Multiple reactivation enrollments:** A lead could be enrolled in multiple reactivation campaigns; how to attribute response/booking? → Current assumption: Attribute to the most recent enrollment where `sentAt` precedes the inbound.
- **Booking process analytics tab name:** Plan says "move booking analytics" but doesn't specify tab name in Analytics → Current assumption: Add as "Booking" tab alongside Overview/CRM.

### Repo mismatches (fix the plan)
- **None found** — File paths and model references are accurate.

### Performance / timeouts
- **Workflow attribution query:** Could timeout on large workspaces (>10k leads with follow-ups) → Add query timeout of 10s and return partial results with warning.
- **Reactivation query:** Enrollments table could grow large → Use indexed query on `sentAt` + workspace scope.

### Security / permissions
- **Access control verified:** `accessibleClientWhere()` and `accessibleLeadWhere()` patterns are used in existing analytics; new queries must use the same filters.
- **Cache leakage prevention:** Cache keys include `userId`, preventing cross-user data access.

### Testing / validation
- **Smoke test checklist added to 88d.**
- **Edge cases:** No follow-up instances (should show 0 workflow, 100% initial), no reactivation campaigns (hide reactivation section or show empty state).

## Assumptions (Agent)

- **Assumption:** "Booked from workflow" = lead has `appointmentBookedAt` AND has a `FollowUpInstance` with `lastStepAt < appointmentBookedAt` (confidence ~95%)
  - Mitigation: If this is wrong, we may need to check `FollowUpTask` completion timestamps instead.

- **Assumption:** Reactivation "responded" = inbound `Message` where `Message.sentAt > ReactivationEnrollment.sentAt` within the window (confidence ~90%)
  - Mitigation: Could add a `respondedAt` field to enrollment for explicit tracking if attribution is disputed.

- **Assumption:** Booking process analytics component can be moved without breaking Settings functionality (only the analytics panel moves, not the booking process editor) (confidence ~98%)
  - Mitigation: Verify Settings still has booking process management UI after move.

## Resolved Questions

- [x] **Should workflow attribution be tied to the specific FollowUpSequence, or just "any workflow sent"?**
  - **Decision:** Per-sequence breakdown (show which specific follow-up sequences drove bookings)
  - This requires: Per-sequence aggregation in the query, UI table/chart showing sequence names with booking counts

- [x] **What tab name should be used for booking process analytics in the Analytics view?**
  - **Decision:** "Booking" tab

## Subphase Index
* a — Metric definitions + query contracts (workflow + reactivation)
* b — Backend actions + date window support
* c — Analytics UI updates + move booking analytics into Analytics
* d — QA, performance checks, and rollout notes
