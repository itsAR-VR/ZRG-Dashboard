# Phase 177a — Supabase Investigation (leadId 370b… + leadId 29c…) + Repro IDs + Replay Manifest

## Focus
Use Supabase (FC workspace) to identify the exact lead/message records for the reported cases (leadId `370b29c7-3370-4bfc-824b-5c4b7172d72a`, leadId `29c19fe2-8142-45f5-9f3e-795de1ae13b1`), determine what booking-process routing/sentiment decisions were made, and capture stable message/thread IDs for regression replay.

## Inputs
- User reports: one lead missed Booking Process 5 handling; another lead was mis-tagged as call requested.
- Existing planning hints in `docs/planning/phase-176/plan.md` suggest FC clientId may be `ef824aca-a3c9-4cde-b51f-2e421ebb6b6e` (must verify in Supabase).

## Work
- Query Supabase for the Founders Club (FC) client and locate Leads by ID:
  - `370b29c7-3370-4bfc-824b-5c4b7172d72a`
  - `29c19fe2-8142-45f5-9f3e-795de1ae13b1`
- For each lead:
  - Identify the relevant inbound Message(s) and timestamps.
  - Determine:
    - stored sentiment tag and any later updates,
    - booking-process routing outcome (including process id 4/5 if present),
    - whether notifications/tasks were created and why.
  - Capture the single best message/thread id(s) to use for replay.
- Create `docs/planning/phase-177/replay-case-manifest.json` containing at minimum:
  - Process 5 case (expected external scheduler link handling)
  - Soft scheduled-call case (expected meeting scheduling, not callback)
  - One explicit callback-request control case (to ensure we don’t break true Process 4 behavior)

## Output
- `docs/planning/phase-177/replay-case-manifest.json`
- Brief notes (in this file) with:
  - leadId, messageId(s), channel,
  - observed sentiment + observed booking-process outcome,
  - hypothesized root cause (ex: router not invoked due to sentiment gating, or router returned non-5).

## Handoff
Phase 177b will use the concrete IDs and the hypothesis from this subphase to trace the exact code gates that prevented Process 5 routing/notifications.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Confirmed FC clientId: `ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`.
  - LeadId: `370b29c7-3370-4bfc-824b-5c4b7172d72a`.
    - Inbound messageId: `25b16aaf-377f-478b-8ba4-7e63e7f0a8ee` (email).
    - Booking-process router ran and produced `processId=5` with `hasExternalCalendarSignal=true` (AIInteraction `action_signal.route_booking_process.outcome.v1` at `2026-02-19 14:33:05Z`).
    - No `NotificationEvent` rows exist for this lead/message, which explains “not sent to Booking Process 5 notifications” even though routing succeeded.
  - LeadId: `29c19fe2-8142-45f5-9f3e-795de1ae13b1`.
    - Inbound messageId: `02b32302-a570-46f3-adf0-7889d31de062` (email).
    - Booking-process router produced `processId=4` (confidence ~0.75–0.78) with `sentimentTag=Call Requested` (likely misrouting; user wants meeting pipeline).
    - A `NotificationEvent(kind='sentiment', sentimentTag='Call Requested')` exists for this message, so the system currently notifies off sentiment (not booking-process route outcomes).
  - Selected explicit callback-request control messageId: `af92aebd-c9d1-4e23-a88e-2514c4994928` (used for replay; older run may not have booking-router telemetry).
  - Created `docs/planning/phase-177/replay-case-manifest.json` with the 3 threadIds above.
- Commands run:
  - Supabase SQL queries via MCP (`mcp__supabase__execute_sql`) — pass
- Blockers:
  - None.
- Next concrete steps:
  - Trace where routing outcomes are supposed to emit notifications and why Process 5 didn’t create any event (Phase 177b).
