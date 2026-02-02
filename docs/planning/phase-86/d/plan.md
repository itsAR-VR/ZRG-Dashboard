# Phase 86d — Slack Alerting + Weekly Dedupe (Per Workspace Channels)

## Focus
Send Slack alerts into each workspace's configured Slack channels when a calendar link is below threshold, with weekly dedupe to prevent spam on cron retries.

## Inputs
- Runner output from Phase 86c: `CalendarHealthResult[]` with `isBelowThreshold` flags.
- Slack posting utility: `lib/slack-bot.ts:187` — `slackPostMessage({ token, channelId, text, blocks? })`.
- Dedupe storage: `prisma/schema.prisma:871` — `NotificationSendLog` with unique `dedupeKey`.
- Workspace Slack config:
  - `Client.slackBotToken` (nullable)
  - `WorkspaceSettings.notificationSlackChannelIds` (String[] @default([]))
  - `WorkspaceSettings.slackAlerts` (Boolean @default(true))

## Work
1. Create or extend `lib/calendar-health-notifier.ts` (can be in same file as runner or separate).
2. Export `sendCalendarHealthAlerts(results: CalendarHealthResult[], referenceDate?: Date)`:
   ```typescript
   interface AlertSummary {
     sent: number;
     skipped: number;         // Already sent this week (dedupe)
     errors: string[];
   }
   ```
3. Compute `weekKey` (ET-anchored Sunday date):
   ```typescript
   function getWeekKey(referenceDate: Date): string {
     // Convert to America/New_York
     // Find the Sunday of this week (or this date if Sunday)
     // Return YYYY-MM-DD
   }
   ```
4. For each result where any calendar has `isBelowThreshold === true`:
   - Skip if `slackAlertsEnabled === false`.
   - Skip if `slackBotToken` is null/empty.
   - Skip if `slackChannelIds` is empty.
   - For each flagged calendar:
     - For each channelId:
       - Build `dedupeKey = calendar_health_weekly:${clientId}:${calendarLinkId}:${weekKey}:${channelId}`.
       - Try to create `NotificationSendLog` row; if unique constraint violation, skip (already sent).
       - If created, call `slackPostMessage()`.
5. Slack message content (no link per user decision):
   ```
   ⚠️ Low Calendar Availability: {calendarName}

   *{workspaceName}* calendar "{calendarName}" has only *{count}* slots available in the next 7 weekdays (threshold: {threshold}).

   📊 Breakdown:
   • Mon 2/3: 2 slots
   • Tue 2/4: 0 slots
   • ...
   ```
6. Rate limiting: Add 200ms delay between Slack posts to respect rate limits.
7. Error handling: Catch Slack API errors, log, add to `errors[]`, continue.

## Validation (RED TEAM)
- Test dedupe: Run twice with same `referenceDate` → second run should skip all.
- Test with workspace missing Slack token → skipped gracefully.
- Test with workspace having 2 channels → both receive alerts.
- Verify `NotificationSendLog` rows created with correct `kind` and `dedupeKey`.

## Output
- Added `lib/calendar-health-notifications.ts` with:
  - `computeEtWeekKey()` (ET-anchored Sunday week key, `YYYY-MM-DD`)
  - `sendWeeklyCalendarHealthSlackAlerts({ workspaces, weekKey? })`
- Slack alerts post via `slackPostMessage()` using each workspace’s `Client.slackBotToken` and `WorkspaceSettings.notificationSlackChannelIds`.
- Weekly idempotency uses `NotificationSendLog` with `kind = "calendar_health_weekly"` and a per-channel dedupe key.

## Handoff
- Proceed to Phase 86e: create `/api/cron/calendar-health` that authenticates via `CRON_SECRET`, gates to Sunday 6pm ET (with `force=1` override), runs `runCalendarHealthChecks`, then calls `sendWeeklyCalendarHealthSlackAlerts`.

## Assumptions / Open Questions (RED TEAM)
- **Assumption:** `NotificationSendLog` doesn't require `leadId` for calendar health alerts (leadId is nullable) (~95% confidence)
  - Verified: `leadId String?` in schema.
- **Assumption:** Week boundary is Sunday 00:00 ET, so alerts sent on Sunday 6pm ET use that Sunday as weekKey (~90% confidence)
  - Mitigation: Document behavior; consistent with "start of week" convention.
- **Assumption:** Plain text with basic Slack markdown is sufficient (~99% confidence)
  - Confirmed: No link required per user decision; plain text is ideal.
