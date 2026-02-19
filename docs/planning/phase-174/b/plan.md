# Phase 174b — Timing Follow-Up Task Upsert Helper + Inbound Integration

## Focus
Implement a shared timing-follow-up helper that converts AI-extracted defer datetimes into lead snooze updates and draft-backed scheduled tasks, then integrate it across inbound classification paths.

## Inputs
- AI extraction contract from `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-174/a/plan.md`
- Target integration files:
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/inbound-post-process/pipeline.ts`
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/email-inbound-post-process.ts`
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/sms-inbound-post-process.ts`
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/linkedin-inbound-post-process.ts`
- Follow-up task and pause helpers used by existing flow:
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/followup-engine.ts`

## Work
1. Add shared helper module (planned: `lib/followup-timing.ts`) that:
   - consumes classification + message + lead/workspace context,
   - calls the AI extractor when final sentiment is `"Follow Up"`,
   - exits early when no concrete date exists.
2. Resolve runtime datetime:
   - timezone priority: lead -> workspace -> UTC,
   - default missing local time to `09:00`,
   - convert resolved local datetime to UTC for persistence.
3. On valid extraction:
   - write `Lead.snoozedUntil`,
   - invoke `pauseFollowUpsUntil(leadId, extractedDateUtc)`,
   - create/update one pending scheduled follow-up task with:
     - `campaignName` (`Scheduled follow-up (auto)` or `Scheduled follow-up (manual)`),
     - `dueDate`,
     - channel type preference/fallback,
     - `suggestedMessage` and optional email `subject`.
4. Dedupe/update policy:
   - if pending scheduled task already exists for the campaign family, update due date + draft fields instead of creating duplicates.
5. No-date extractor behavior:
   - do not create/update timing task,
   - emit Slack ops alert with dedupe + lead/message identifiers (reuse existing dedupe notification patterns).
6. Integrate helper in all inbound paths after final sentiment classification is known.

## Validation
- Inbound follow-up messages with explicit defer dates create/update scheduled tasks consistently across email/SMS/LinkedIn flows.
- Inbound follow-up messages without concrete defer dates do not create timing tasks and emit ops visibility alerts.
- Sequence pause and `snoozedUntil` updates are aligned to task due date.
- Repeated defer messages upsert the same pending scheduled task (no duplicate pending rows).

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/followup-timing.ts` with shared scheduler helper:
    - sentiment gate on `"Follow Up"`,
    - timezone chain (`extract -> lead -> workspace -> UTC`),
    - due-date conversion + future-date guard,
    - single pending-task upsert (`campaignName` starts with `"Scheduled follow-up"`),
    - draft persistence (`suggestedMessage`, `subject`) and lead pause/snooze updates.
  - Added Slack ops alert path for extraction misses with dedupe via `NotificationSendLog`.
  - Wired helper into:
    - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/inbound-post-process/pipeline.ts`
    - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/email-inbound-post-process.ts`
    - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/sms-inbound-post-process.ts`
    - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/linkedin-inbound-post-process.ts`
  - Preserved deterministic snooze fallback for non-follow-up sentiment paths.
- Commands run:
  - `npm run build` — pass.
  - `npm run test -- lib/__tests__/followup-timing.test.ts` — pass.
- Blockers:
  - None.
- Next concrete steps:
  - Process due `"Scheduled follow-up (auto)"` tasks from follow-ups cron with send safety gates.

## Output
- Shared helper + call-site integration shipped across all inbound post-process paths.
- Deterministic single-task upsert behavior is implemented with draft fields and no-date alerting.

## Handoff
Proceed to **174c** to process due scheduled tasks in cron with safe auto-send and manual fallback handling.
