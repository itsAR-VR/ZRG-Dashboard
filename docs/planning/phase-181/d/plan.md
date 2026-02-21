# Phase 181d — Deferred Follow-Up Task Engine (Schedule, Dedupe, Cancel, Retry)

## Focus
Create and manage deferred-window follow-up tasks that execute exactly at the promised pre-window time.

## Inputs
- Output from Phase 181c.
- Existing follow-up task systems:
  - `lib/followup-timing.ts`
  - `lib/followup-task-drafts.ts`
  - `actions/followup-actions.ts`
  - follow-up cron processors.

## Work
1. Add deferred-window task type/metadata strategy (without breaking current follow-up task consumers).
2. Schedule due date as `window_start - 7 days` (business-day adjustment policy if already used by scheduler).
3. Add dedupe and idempotency keys to prevent duplicate deferred tasks for same lead/window/message.
4. Add cancel/complete semantics:
   - cancel pending deferred tasks on new inbound that provides exact schedulable time,
   - cancel when meeting is booked or lead hard-no/opt-out detected.
5. Define availability-fetch-failure fallback path:
   - send defer reply,
   - enqueue retry job,
   - emit Slack warning with failure reason.

## Output
- Deferred follow-up tasks created, deduped, and lifecycle-managed deterministically.

## Handoff
Phase 181e integrates execution in cron/auto-send and operational telemetry.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented dual-task deferral lifecycle for parseable future windows beyond coverage:
    - immediate notice task (due now),
    - deferred recontact task (due = window start - 7 days, weekend-adjusted).
  - Added idempotent update-or-create behavior for both task classes using campaign prefixes.
  - Added clarify-task cancellation reuse (`cancelPendingTimingClarifyTasks`) so deferral replaces clarify attempts cleanly.
  - Added availability retry queueing (`queueAvailabilityRefreshRetry`) on fetch failure.
  - Preserved pause/snooze semantics by pausing until deferred recontact due date.
- Commands run:
  - Code implementation pass in `lib/followup-timing.ts`.
- Blockers:
  - none
- Next concrete steps:
  - Verify no duplicate task side-effects in replay pass (phase 181f).
