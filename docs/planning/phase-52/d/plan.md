# Phase 52d — Inbound: Call Tasks + Notification Center + Lead Calendar-Link Handling

## Focus
Implement the remaining inbound processes and the new notification scope:

- (4) “Call requested” → create a **call** follow-up task (deduped) and notify via Notification Center.
- “Lead is interested” (positive sentiment) → notify via Notification Center (deduped).
- (5) “Lead sent their calendar link” → reliably capture the link and either (a) automate *if approved and supported* or (b) create a manual scheduling task with the link + context.

## Inputs
- Phase 52a flow spec and stakeholder clarifications about what “schedule it in” means.
- Existing sentiment categories (“Call Requested”, “Meeting Booked”) and signature extraction fields (phone + scheduling link).
- Existing follow-up task system (`FollowUpTask` types include `"call"`; UI surfaces pending tasks).
- Settings + notification toggles:
  - `WorkspaceSettings.emailDigest`, `WorkspaceSettings.slackAlerts`
  - `actions/settings-actions.ts` / `components/dashboard/settings-view.tsx`
- Slack utilities:
  - Legacy env-based: `lib/slack-notifications.ts` (webhook), `lib/slack-dm.ts` (DM by email)
  - Per-workspace bot token: `lib/slack-bot.ts` + `actions/slack-integration-actions.ts`
- Email notifications: Resend via `lib/resend-email.ts`
- External availability fetchers (`lib/calendar-availability.ts`).
  - Lead-provided scheduler link handling: `lib/scheduling-link.ts`, `lib/lead-scheduler-link.ts`

## Work
### A) Notification Center (settings + delivery)

1. **Data model (schema)**
   - General Settings (per workspace):
     - recipients: `WorkspaceSettings.notificationEmails[]`, `WorkspaceSettings.notificationPhones[]`
     - Slack destinations: `WorkspaceSettings.notificationSlackChannelIds[]` (selected via channel picker)
     - per-sentiment rules: `WorkspaceSettings.notificationSentimentRules` (mode: off/realtime/daily, destinations per rule)
     - daily digest time: `WorkspaceSettings.notificationDailyDigestTime` (e.g., `09:00`)
   - Integrations:
     - Slack bot token stored server-side: `Client.slackBotToken`
   - Delivery dedupe:
     - `NotificationEvent` table to record events (sentiment transitions)
     - `NotificationSendLog` table to enforce idempotent send per destination/time window

2. **Server actions**
   - Settings actions:
     - read/write Notification Center fields (admin gated)
   - Slack integration actions (admin-only):
     - validate token (`auth.test`) before saving
     - list channels (`conversations.list`) so the UI can store channel IDs
     - never return raw token to client (masked status only)

3. **UI**
   - In `components/dashboard/settings-view.tsx` (General Settings tab):
     - Notification Center UI:
       - manage recipient lists: email + phone (phone is “coming soon” for delivery)
       - per-sentiment rules: Mode (Off / Realtime / Daily) and destinations (Slack / Email / Phone)
       - daily digest time input
   - In `components/dashboard/settings-view.tsx` (Integrations tab):
     - Slack integration card:
       - input Slack **bot token** (xoxb-…)
       - channel selector (list channels, add selected channel IDs)
       - show masked saved value + “clear” action

4. **Delivery implementation**
   - Implement a single entrypoint (e.g., `lib/notification-center.ts`) that:
     - evaluates prefs
     - enforces dedupe
     - sends to enabled destinations
   - Dedupe policy (minimum viable):
     - per lead + event (sentiment) + destination within a TTL (e.g., 30–120 minutes), so webhook retries and “same sentiment again” doesn’t spam.
   - Slack: `chat.postMessage` via bot token + selected channel IDs.
   - Email: Resend (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`).
   - Phone: store config + show “coming soon” (delivery is intentionally a no-op for now).
   - Daily digests: for sentiments configured as Daily, send a once-per-day digest (Slack/email) via cron.

### B) Process (4): Call Requested → call task + notify

1. Define trigger:
   - `lead.sentimentTag === "Call Requested"`
   - `lead.phone` is present (stored normalized) OR we can persist extracted phone to lead first.
2. Create a follow-up task:
   - `type="call"`, `dueDate=now`, `status="pending"`
   - include phone + context in `suggestedMessage`
   - idempotency: avoid duplicate tasks (suggested key: `campaignName="call_requested"` + check for pending existing)
3. Notify:
   - use Notification Center routing (Slack/email/SMS) based on workspace settings

### C) “Lead is interested” notifications

1. Trigger on sentiment transitions (preferred):
   - when a lead becomes a configured sentiment for the first time (or within TTL window)
2. Notify:
   - include lead name + channel + last inbound snippet + link to thread (if we have a UI URL pattern)

### D) Process (5): Lead calendar link handling

1. Capture:
   - persist the detected scheduling link on the lead (`Lead.externalSchedulingLink`) with a timestamp
2. Decide automation vs fallback:
   - Current safe behavior: create a deduped follow-up task (`campaignName="lead_scheduler_link"`) that includes:
     - the lead’s scheduler link
     - an overlap suggestion (if one exists) computed by intersecting lead availability + workspace availability
     - a fallback booking link (our scheduler) when available
   - Future automation (open): “book on their scheduler link” as an invitee is provider-specific and may require OAuth or explicit approval for browser automation.

## Validation (RED TEAM)

- Schema changes: run `npm run db:push` and verify new fields/models exist.
- Slack: save a bot token, list channels, select a channel, and verify a test notification arrives.
- Email: configure `RESEND_API_KEY` + `RESEND_FROM_EMAIL` and verify a test notification arrives.
- Inbound: simulate a sentiment transition to “Call Requested” with a phone and confirm:
  - `FollowUpTask(type="call", campaignName="call_requested")` is created once
  - notification is sent once (deduped)

## Output
- Schema + settings plan for Notification Center + Slack integration.
- Concrete implementation steps + idempotency keys for call tasks, notifications, and calendar-link handling.

## Output (Completed)

### A) Notification Center (settings + delivery)

#### Schema changes (`prisma/schema.prisma`)
- `Client.slackBotToken` — Per-workspace Slack bot token (stored server-side)
- `Client.resendApiKey`, `Client.resendFromEmail` — Per-workspace Resend config
- `WorkspaceSettings.notificationEmails[]`, `notificationPhones[]` — Recipient lists
- `WorkspaceSettings.notificationSlackChannelIds[]` — Selected Slack channels
- `WorkspaceSettings.notificationSentimentRules` — Per-sentiment rules (mode + destinations)
- `WorkspaceSettings.notificationDailyDigestTime` — Daily digest time (HH:mm)
- `NotificationEvent` — Events for auditing + daily aggregation (deduped by `dedupeKey`)
- `NotificationSendLog` — Send records for realtime idempotency (deduped by `dedupeKey`)

#### Implementation
- `lib/notification-center.ts`:
  - `notifyOnLeadSentimentChange()` — Realtime dispatch on sentiment change (Slack + email)
  - `recordSentimentNotificationEvent()` — Event recording for digests
  - `processDailyNotificationDigestsDue()` — Daily digest processor (integrated in followups cron)
  - Dedupe via `NotificationSendLog` with TTL bucketing (1hr default for realtime)
- `lib/slack-bot.ts`:
  - `slackAuthTest()` — Validate bot token
  - `slackListConversations()` — List channels for picker
  - `slackPostMessage()` — Send to channel
- `lib/resend-email.ts`:
  - `sendResendEmail()` — Per-workspace email delivery via Resend API
- `actions/slack-integration-actions.ts`:
  - `getSlackBotTokenStatus()` — Masked token status
  - `updateSlackBotToken()` — Save with validation
  - `listSlackChannelsForWorkspace()` — Channel list for UI
- `actions/resend-integration-actions.ts`:
  - `getResendConfigStatus()` — Masked API key + from email
  - `updateResendConfig()` — Save config

#### UI
- Notification Center section in General Settings:
  - Per-sentiment rules table (mode: Off/Realtime/Daily, destinations: Slack/Email/SMS)
  - Recipient lists (emails + phones)
  - Daily digest time picker
- Integrations tab:
  - Slack card: bot token input, channel selector, validation
  - Resend card: API key + from email inputs

### B) Process (4): Call Requested → call task + notify

- `lib/call-requested.ts:ensureCallRequestedTask()`:
  - Trigger: `lead.sentimentTag === "Call Requested"` and phone present
  - Creates `FollowUpTask(type="call", campaignName="call_requested")`
  - Idempotency: checks for existing pending task before creating
- Integrated in `lib/inbound-post-process/pipeline.ts`:
  - Fires after sentiment classification
  - Non-blocking with `.catch(() => undefined)`

### C) "Lead is interested" notifications

- `notifyOnLeadSentimentChange()` fires for any configured sentiment transition
- Realtime dispatch when `rule.mode === "realtime"`
- Daily aggregation when `rule.mode === "daily"`

### D) Process (5): Lead calendar link handling

- `lib/scheduling-link.ts:extractSchedulerLinkFromText()`:
  - Extracts Calendly/HubSpot/GHL scheduler links from message text
- `Lead.externalSchedulingLink`, `Lead.externalSchedulingLinkLastSeenAt`:
  - Persisted in inbound pipeline when link detected
- `lib/lead-scheduler-link.ts:handleLeadSchedulerLinkIfPresent()`:
  - Trigger: `lead.sentimentTag === "Meeting Booked"` (explicit booking intent)
  - Fetches lead scheduler availability (Calendly/HubSpot/GHL)
  - Computes overlap with workspace availability
  - Creates manual review task with overlap suggestion (or fallback if no overlap)
  - Idempotency: `campaignName="lead_scheduler_link"` dedupe

## Handoff
Proceed to Phase 52e with the list of new behaviors to cover via tests and a concrete manual verification runbook.

## Review Notes

- Evidence:
  - `lib/notification-center.ts` (661 lines)
  - `lib/call-requested.ts` (65 lines)
  - `lib/scheduling-link.ts` (44 lines)
  - `lib/lead-scheduler-link.ts` (147 lines)
  - `lib/slack-bot.ts` (155 lines)
  - `lib/resend-email.ts` (75 lines)
  - Schema: `NotificationEvent`, `NotificationSendLog` models added
- Deviations:
  - SMS delivery is intentionally a no-op placeholder per plan
  - Third-party scheduler booking automation deferred to follow-on per plan
- Follow-ups:
  - Wire SMS provider when ready
  - Playwright/Fly.io for third-party scheduler automation
