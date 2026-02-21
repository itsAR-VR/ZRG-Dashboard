# Phase 177b — Locate Current Booking Process Router + Notification Gates (Code Trace)

## Focus
Locate where Booking Process routing decisions (especially Process 4 and 5) are computed and where notifications are emitted, then identify the specific gating conditions that caused the Process 5 miss for leadId `370b29c7-3370-4bfc-824b-5c4b7172d72a` and suppressed Process 4/5 notifications for Interested/other sentiments.

## Inputs
- Phase 177a: concrete lead/message IDs + observed routing/sentiment outcomes.

## Work
- Trace booking-process routing code path(s):
  - where the router is invoked (what sentiments/channels trigger it),
  - how Process 4 vs 5 is decided/stored,
  - how the result influences downstream tasks/notifications.
- Trace notification logic for booking-process outcomes:
  - identify current sentiment gating (ex: only Meeting Requested / Call Requested),
  - identify dedupe rules and where to safely expand eligibility.
- Produce a minimal edit plan:
  - files/functions to change,
  - the smallest condition changes required to satisfy the user requirements.

Concrete starting points (repo reality):
- Booking-process router + outcome shaping:
  - `lib/action-signal-detector.ts` (search `ACTION_SIGNAL_ROUTE_BOOKING_PROCESS_SYSTEM`, `action_signal.route_booking_process.outcome.v1`)
  - `lib/ai/prompt-registry.ts` (prompt key `action_signal.route_booking_process.v1`)
- Notification recording + sending:
  - `lib/notification-center.ts` (search `recordSentimentNotificationEvent`, `processRealtimeNotificationEventsDue`)
  - Prisma model: `NotificationEvent` in `prisma/schema.prisma`

## Output
- List of target files/functions with current behavior summary.
- Proposed minimal patch plan for Phase 177c/177d.

## Handoff
Phase 177c will implement the routing eligibility change(s) and Phase 177d will implement call-intent disambiguation.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Located booking-process router + signals:
    - `lib/action-signal-detector.ts`:
      - AI router prompt key: `action_signal.route_booking_process.v1`
      - Telemetry: `recordBookingProcessRouteOutcome()` writes `action_signal.route_booking_process.outcome.v1` with `{ processId, confidence, uncertain, hasCallSignal, hasExternalCalendarSignal }`.
      - Slack notifications: `notifyActionSignals(...)` (dedupe via `NotificationSendLog.kind='action_signal'`).
  - Located scheduler-link persistence + downstream tasking:
    - Link extraction: `extractSchedulerLinkFromText()` in `lib/scheduling-link.ts` (did not match Notion links; explains why `Lead.externalSchedulingLink` stayed null for leadId `370b29c7-3370-4bfc-824b-5c4b7172d72a`).
    - Manual task path: `handleLeadSchedulerLinkIfPresent()` in `lib/lead-scheduler-link.ts` (previously gated by sentiment; did not use `latestInboundText`).
  - Located call task creation gate:
    - `ensureCallRequestedTask()` in `lib/call-requested.ts` was sentiment-gated (`sentimentTag === 'Call Requested'`), so Process 4 detection under other sentiments could not create tasks.
- Commands run:
  - `rg "route_booking_process|notifyActionSignals|externalSchedulingLink|ensureCallRequestedTask|handleLeadSchedulerLinkIfPresent"` — pass
- Blockers:
  - None.
- Next concrete steps:
  - Implement: Notion scheduler link extraction + explicit-instruction gating for scheduler tasks + call-task creation when Process 4 is detected under other sentiments (Phase 177c).
  - Implement: AI prompt disambiguation updates to avoid “soft call” -> Process 4 / Call Requested (Phase 177d).
