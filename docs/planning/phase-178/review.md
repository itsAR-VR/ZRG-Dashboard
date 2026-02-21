# Phase 178 Review — FC Booking Process 4/5 Routing Eligibility + Call vs Meeting Disambiguation

Status: Complete (implementation + replay validation complete)

## What Changed
- Process 5 (lead-provided scheduler link) handling:
  - Recognize Notion Calendar meet links as scheduler links (`lib/scheduling-link.ts`).
  - Ensure the downstream handler can create a `lead_scheduler_link` follow-up task even when “reply-only” email cleaning strips the URL (signature link case) by passing an observed link from the full message (`lib/lead-scheduler-link.ts` + call-site plumbing).
  - Key task creation off booking-process router outcome (`processId=5`) via `forceBookingProcess5` to cover phrasing variants (while keeping the router prompt guardrail that signature-only links are not enough).
- Process 4 (callback intent) handling:
  - Allow call-request task creation when booking-process routing detects callback intent under other sentiments (`lib/call-requested.ts` + call sites).
- AI disambiguation hardening:
  - Update router + sentiment prompt guidance so scheduled-call language (call-as-meeting) is not treated as callback intent (Process 4).

## Evidence (Supabase)
- Lead `370b29c7-3370-4bfc-824b-5c4b7172d72a` / message `25b16aaf-377f-478b-8ba4-7e63e7f0a8ee`:
  - Booking-process router: `processId=5`, `confidence=0.9`, `hasExternalCalendarSignal=true` (AIInteraction promptKey `action_signal.route_booking_process.outcome.v1`).
  - Message contains `calendar.notion.so` link (boolean check), but `externalSchedulingLink` was `null` and no `FollowUpTask(campaignName='lead_scheduler_link')` existed.
- Lead `29c19fe2-8142-45f5-9f3e-795de1ae13b1` / message `02b32302-a570-46f3-adf0-7889d31de062`:
  - Booking-process router: `processId=4`, `confidence≈0.75–0.78`.
  - A `FollowUpTask(type='call', campaignName='call_requested')` exists.

## Validation
- `npm run lint` — pass (warnings only)
- `npm run build` — pass
- `npm test` — pass (419/419)
- `npm run test:ai-drafts` — pass

## NTTAN Replay
- Dry run:
  - command: `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-178/replay-case-manifest.json --dry-run --ab-mode overseer`
  - artifact: `.artifacts/ai-replay/run-2026-02-21T14-19-31-142Z.json`
  - selected: 3 / 3
- Live run:
  - command: `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-178/replay-case-manifest.json --concurrency 3 --ab-mode overseer`
  - artifact: `.artifacts/ai-replay/run-2026-02-21T14-19-36-353Z.json`
  - summary: evaluated=2, passed=1, failedJudge=1, averageScore=74.5
  - judgePromptKey: `meeting.overseer.gate.v1`
  - judgeSystemPrompt: `PER_CASE_CLIENT_PROMPT`
  - failureTypeCounts: `draft_quality_error=1` (all others 0)
  - criticalInvariantCounts: `slot_mismatch=0`, `date_mismatch=0`, `fabricated_link=0`, `empty_draft=0`, `non_logistics_reply=0`

Case-level notes:
- `25b16aaf-377f-478b-8ba4-7e63e7f0a8ee` (Process 5 expected case): evaluated + pass.
- `02b32302-a570-46f3-adf0-7889d31de062` (soft scheduled-call case): skipped by current sentiment gate (`Not Interested`), not infra failure.
- `af92aebd-c9d1-4e23-a88e-2514c4994928` (explicit callback control): evaluated; one draft-quality miss.

## Known Limitations / Rollout Notes
- This phase hardens future inbound handling; it does not automatically backfill historical Process 5 messages into `lead_scheduler_link` tasks.
- Task creation still requires an extracted scheduler URL (inbound body or signature) to avoid creating empty/unclear tasks.
