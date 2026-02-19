# Phase 174c — Due Task Auto-Send Processor in Follow-Ups Cron

## Focus
Extend follow-ups cron processing to evaluate and send due scheduled timing tasks safely for email/SMS, with explicit reschedule/manual fallback outcomes.

## Inputs
- Task creation/upsert behavior from `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-174/b/plan.md`
- Existing cron/follow-up processor surfaces:
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/cron/followups.ts`
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/followup-engine.ts`
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/app/api/cron/followups/route.ts`
- Send + gate utilities:
  - `resolveAutoSendScheduleConfig`, `isWithinAutoSendSchedule`
  - `approveAndSendDraftSystem` + `AIDraft` creation path.

## Work
1. Add scheduled-task processor step (`processScheduledTimingFollowUpTasksDue`) into follow-ups flow, compatible with direct cron and dispatch mode.
2. Scope processor to due pending tasks with auto campaign and sendable channels (`email`, `sms`).
3. Enforce safety checks before send:
   - lead not blacklisted/opted out,
   - workspace follow-ups not paused,
   - no new conversation activity after task creation,
   - within allowed auto-send schedule window.
4. Schedule window behavior:
   - if outside send window, compute next allowed window and update task `dueDate`.
5. Send behavior:
   - create send-time `AIDraft` with deterministic `triggerMessageId` namespace (`followup_task:<taskId>`),
   - call `approveAndSendDraftSystem` for send execution.
6. Result behavior:
   - success -> `status = completed`,
   - blocked/failure/unsupported -> switch campaign to manual and keep pending.
7. Guard execution with env flags:
   - `FOLLOWUP_TASK_AUTO_SEND_ENABLED`
   - optional `FOLLOWUP_TASK_AUTO_SEND_LIMIT`.
8. Preserve cron contract:
   - do not change auth semantics (`CRON_SECRET`) or dispatch lock behavior in route-level flow.

## Validation
- Due auto tasks in-window and safe send successfully and transition to completed.
- Out-of-window tasks reschedule without sending.
- Blocked safety conditions prevent send and convert task to manual pending.
- LinkedIn/call task types remain manual and are never auto-sent by this processor.
- Dispatch-only cron mode still works unchanged.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added due-task processor in `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/followup-timing.ts`:
    - scope: pending + due + `campaignName="Scheduled follow-up (auto)"`,
    - channel gate: auto-send only `email`/`sms`,
    - safety gates: blacklist/opt-out, workspace follow-ups paused, post-schedule conversation activity,
    - schedule-window reschedule via `resolveAutoSendScheduleConfig` + `isWithinAutoSendSchedule`,
    - send execution via send-time `AIDraft` + `approveAndSendDraftSystem`,
    - fallback on blocked/failed paths to manual pending campaign.
  - Hooked processor into `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/cron/followups.ts` and returned `scheduledTiming` in cron response payload.
- Commands run:
  - `npm run build` — pass.
  - `npm run lint` — pass (warnings only).
- Blockers:
  - None.
- Next concrete steps:
  - Lock validation evidence and tests, then close docs/rollout guidance.

## Output
- Follow-ups cron now includes scheduled timing-task due processing with safe auto-send + manual fallback behavior.

## Handoff
Proceed to **174d** for extractor/unit coverage plus full AI/message NTTAN replay validation.
