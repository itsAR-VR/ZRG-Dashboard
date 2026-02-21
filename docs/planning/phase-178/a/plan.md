# Phase 178a — Supabase Investigation + Repro IDs + Replay Manifest

## Focus
Use Supabase (FC workspace) to confirm the exact lead/message records for the reported cases, determine what booking-process routing/sentiment decisions were made, and capture stable message/thread IDs for regression replay.

## Inputs
- FC clientId (from prior investigation): `ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`.
- Known case IDs (from prior notes; verify current state in DB):
  - Lead: `370b29c7-3370-4bfc-824b-5c4b7172d72a`, inbound message: `25b16aaf-377f-478b-8ba4-7e63e7f0a8ee`.
  - Lead: `29c19fe2-8142-45f5-9f3e-795de1ae13b1`, inbound message: `02b32302-a570-46f3-adf0-7889d31de062`.
  - Callback control message: `af92aebd-c9d1-4e23-a88e-2514c4994928`.

## Work
- Query leads/messages and confirm:
  - booking-process route outcome (process id + confidence) from AI telemetry, if present.
  - whether any scheduler link was extracted/persisted on the lead.
  - whether follow-up tasks and/or Slack notification dedupe logs exist for the message.
- Create `docs/planning/phase-178/replay-case-manifest.json` with at least:
  - External scheduler link case (expected Process 5 handling)
  - Soft-call scheduling case (expected meeting scheduling, not callback)
  - Explicit callback control case

## Output
- Created replay manifest:
  - `docs/planning/phase-178/replay-case-manifest.json`
- Supabase-backed findings (no message bodies):
  - Lead `370b29c7-3370-4bfc-824b-5c4b7172d72a` / message `25b16aaf-377f-478b-8ba4-7e63e7f0a8ee`:
    - Booking-process router outcome: `processId=5`, `confidence=0.9`, `hasExternalCalendarSignal=true` (AIInteraction promptKey `action_signal.route_booking_process.outcome.v1`).
    - Message body contains `calendar.notion.so` link (boolean check in SQL), but `Lead.externalSchedulingLink` is still `null`.
    - No `FollowUpTask(campaignName='lead_scheduler_link')` exists for this lead.
    - Slack action-signal send log exists (`NotificationSendLog.kind='action_signal'`, `book_on_external_calendar`).
  - Lead `29c19fe2-8142-45f5-9f3e-795de1ae13b1` / message `02b32302-a570-46f3-adf0-7889d31de062`:
    - Booking-process router outcome: `processId=4`, `confidence≈0.75–0.78`, `hasCallSignal=true` (AIInteraction promptKey `action_signal.route_booking_process.outcome.v1`).
    - Sentiment notification event exists for `Call Requested` (NotificationEvent kind `sentiment`).
    - A pending call task exists (`FollowUpTask(type='call', campaignName='call_requested')`).

## Handoff
Phase 178b should focus on the downstream “Process 5 handling” gap: for Notion scheduler links with explicit instruction, persist `Lead.externalSchedulingLink` and create the `lead_scheduler_link` follow-up task, while updating prompts to reduce Process 4 false positives for scheduled-call language.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Queried Supabase for the two FC leads + messages and verified booking router outcomes, Slack notification logs, and task/lead fields.
  - Created `docs/planning/phase-178/replay-case-manifest.json`.
- Commands run:
  - Supabase SQL via MCP (`mcp__supabase__execute_sql`) — pass (one query typo ignored; reran where needed)
- Blockers:
  - None.
- Next concrete steps:
  - Implement/verify Notion scheduler link extraction + explicit-instruction gating and ensure `lead_scheduler_link` task is created (Phase 178b).
