# Phase 180c — Fix Booking/Call Draft Semantics (no booking followup_task drafts; call requested no auto-send; narrow backfills)

## Focus
Prevent Meeting Requested booking flows from creating `followup_task:*` drafts that hijack the compose UI, ensure Call Requested never auto-sends (but still drafts), and ensure maintenance/backfill logic can’t reintroduce the bad routed drafts.

## Inputs
- Phase 180b routing suppression changes (Meeting Requested now drafts normally).
- Current `processMessageForAutoBooking(...)` behavior in `lib/followup-engine.ts`.
- Existing task→draft backfill helper: `lib/followup-task-drafts.ts` (called from inbound processors + `lib/background-jobs/maintenance.ts`).

## Work
1. Booking follow-up tasks/drafts:
   - In `lib/followup-engine.ts`, remove/disable creation of booking-related `FollowUpTask` + `AIDraft(triggerMessageId="followup_task:*")` for Meeting Requested clarification/no-match paths.
   - Preserve auto-booking behavior when a slot is truly accepted (no draft required because a booking confirmation send may occur).
   - Ensure `AutoBookingContext` still captures useful scheduling signals for `generateResponseDraft(...)` (but do not create competing drafts).

2. Call Requested policy (locked):
   - Draft generation remains enabled for Call Requested.
   - Auto-send must be skipped for Call Requested in all modes:
     - Extend the existing orchestrator skip logic in `lib/auto-send/orchestrator.ts` to skip when `sentimentTag === "Call Requested"` (in addition to `actionSignalCallRequested === true`).

3. Backfill narrowing (prevent reintroduction):
   - Update `lib/followup-task-drafts.ts` to only backfill drafts for intended follow-up purposes:
     - Follow-up sequence tasks (`instanceId` + `stepOrder` present), and/or
     - Follow-up timing clarify tasks (campaignName prefix used by `lib/followup-timing.ts`).
   - Ensure ad-hoc booking tasks (and other non-follow-up tasks) are excluded from backfill eligibility.
   - Confirm `lib/background-jobs/maintenance.ts` continues to call backfill safely under the new eligibility rules.

## Output
- Meeting Requested no longer produces `followup_task:*` drafts from booking clarification logic.
- Call Requested never auto-sends, but drafts still exist for human sending.
- Backfill/maintenance cannot recreate the undesired routed booking drafts.

## Handoff
Proceed to Phase 180d for tests, replay coverage, NTTAN validation, and phase review.

## Progress This Turn (2026-02-21)
- Booking clarification flow no longer creates booking-path `followup_task:*` drafts from `processMessageForAutoBooking(...)`:
  - `lib/followup-engine.ts` now uses clarification context setters instead of task/draft creation in no-match/clarification branches.
- Backfill scope narrowed to intended follow-up sources:
  - `lib/followup-task-drafts.ts` adds `isEligibleFollowUpTaskDraftSource(...)` and `hasPendingEligibleFollowUpTaskDraft(...)`.
  - Eligible classes are sequence tasks (`instanceId` + `stepOrder`), timing-clarify campaigns (`Follow-up timing clarification*`), and `Scheduled follow-up (auto)`.
  - Explicitly excludes ad-hoc booking/manual campaign names like `lead_scheduler_link` and `call_requested`.
- Auto-send skip policy hardened for call intent:
  - `lib/auto-send/orchestrator.ts` now skips when either `actionSignalCallRequested` or `sentimentTag === "Call Requested"`.
- Regression coverage added:
  - `lib/__tests__/followup-task-drafts.test.ts`
  - `lib/auto-send/__tests__/orchestrator.test.ts` (sentiment-only Call Requested auto-send skip case)

## Conflict Log
- Issue: Existing Process 4/5 routing changes in phases 177/178 overlap with call and scheduler-link semantics.
- Overlap phase(s): 177, 178, 179.
- File(s): `lib/followup-engine.ts`, `lib/followup-task-drafts.ts`, `lib/auto-send/orchestrator.ts`.
- Resolution: Preserved Process 5 behavior and limited changes to (a) booking clarification draft-source semantics, (b) follow-up task backfill eligibility, and (c) call-requested auto-send skip expansion.
- Residual risk: Legacy follow-up tasks with ambiguous campaign naming may not be considered “eligible routed drafts” and will now fall back to normal draft generation.
