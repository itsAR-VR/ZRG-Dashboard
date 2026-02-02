# Phase 80d — Integration: Orchestrator Schedule Check

## Focus

Integrate schedule checking into the auto-send orchestrator so messages are delayed to valid windows when outside schedule.

## Inputs

- Phase 80c complete (`lib/auto-send-schedule.ts` exists)
- Current orchestrator: `lib/auto-send/orchestrator.ts`
- Delayed send infrastructure: `lib/background-jobs/ai-auto-send-delayed.ts`

## Work

1. **Modify `executeAiAutoSendPath()` in orchestrator:**

   Add schedule check at the start of the AI auto-send path:
   ```typescript
   // Fetch workspace settings for schedule config
   const workspaceSettings = await prisma.workspaceSettings.findUnique({
     where: { clientId: context.clientId },
     select: {
       timezone: true,
       workStartTime: true,
       workEndTime: true,
       autoSendScheduleMode: true,
       autoSendCustomSchedule: true,
     }
   });

   // Resolve effective schedule (campaign overrides workspace)
   const scheduleConfig = resolveAutoSendScheduleConfig(workspaceSettings, context.emailCampaign);
   const scheduleCheck = isWithinAutoSendSchedule(scheduleConfig);

   if (!scheduleCheck.withinSchedule) {
     const nextWindow = getNextAutoSendWindow(scheduleConfig);

     // Schedule delayed send for next valid window
     await scheduleDelayedAutoSend({
       ...params,
       runAt: nextWindow,
     });

     await recordAutoSendDecision({
       action: "send_delayed",
       reason: `outside_schedule:${scheduleCheck.reason}:next_window:${nextWindow.toISOString()}`
     });

     return {
       mode: "AI_AUTO_SEND",
       outcome: { action: "send_delayed", runAt: nextWindow },
       telemetry: { scheduledReason: scheduleCheck.reason }
     };
   }
   ```

2. **Modify delayed send job runner:**

   In `lib/background-jobs/ai-auto-send-delayed.ts`, add schedule re-check before execution:
   ```typescript
   // Re-check schedule at execution time (in case settings changed)
   const scheduleConfig = await loadScheduleConfigForLead(params.leadId);
   const scheduleCheck = isWithinAutoSendSchedule(scheduleConfig);

   if (!scheduleCheck.withinSchedule) {
     // Reschedule to next window
     const nextWindow = getNextAutoSendWindow(scheduleConfig);
     throw new RescheduleJobError(nextWindow);
   }
   ```

3. **Update AutoSendContext type** to include schedule info for telemetry

4. **Verify:**
   - `npm run lint`
   - `npm run build`

## Output

- `lib/auto-send/orchestrator.ts` now resolves schedule config and defers auto-send to the next valid window when outside schedule.
- Added schedule-aware rescheduling for delayed jobs via `RescheduleBackgroundJobError` + runner handling.
- `lib/background-jobs/ai-auto-send-delayed.ts` re-checks schedule at execution time and reschedules when needed.

## Handoff

With auto-send scheduling complete, proceed to Phase 80e to centralize follow-up pause on booking.
