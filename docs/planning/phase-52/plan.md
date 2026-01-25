# Phase 52 — Booking Automation: 5 Booking Processes

## Purpose
Verify and close gaps so the AI can reliably execute the five booking processes described (link-first, offered-time auto-booking, lead-proposed-time auto-booking, call-me notifications, and lead-provided calendar link handling).

## Context
Stakeholder requirements describe **five distinct booking processes** the AI must support:

1. **Send booking link on interest** (no suggested times) and the lead self-schedules. **Link reply must include qualification question(s).**
2. **We already sent specific times** in the initial email; the lead picks one and the system **auto-books that time**. **No qualification questions.**
3. Lead replies with **times they can do**; the system **auto-books** an available time. **No qualification questions.**
4. Lead says **“call me” and provides their cell**; system **notifies the client to call** (not an auto-book).
5. Lead sends **their calendar link**; AI **checks availability and schedules**.

### Current system (what we already have)
- **Outbound “booking process stages”**: stages can include booking link, suggested times, qualifying questions, timezone ask (`lib/booking-process-instructions.ts`, injected via `lib/ai-drafts.ts`). This can express (1) *if configured*.
- **Templates (Phase 52b)**: all five booking processes exist as templates in `lib/booking-process-templates.ts` and can be bulk-created via `actions/booking-process-actions.ts`.
- **Stage instruction ordering (Phase 52b)**: `BookingProcessStage.instructionOrder` supports questions-first / times-first / link-first, enforced in `lib/booking-process-instructions.ts`.
- **Availability + offered slots persistence**: when the AI proposes times (or Phase 55 injects first-touch times), the system persists `Lead.offeredSlots`.
- **Auto-booking (Phase 52c)**: `lib/followup-engine.ts:processMessageForAutoBooking()` can auto-book on:
  - clear acceptance of one of the previously offered slots, and
  - high-confidence lead-proposed times that intersect workspace availability.
- **Call task creation (Phase 52d)**: `lib/call-requested.ts:ensureCallRequestedTask()` creates a deduped `FollowUpTask(type="call")` when sentiment is `"Call Requested"` and a phone exists.
- **Notification Center (Phase 52d)**:
  - Slack: per-workspace **bot token** stored server-side (`Client.slackBotToken`) + channel IDs (`WorkspaceSettings.notificationSlackChannelIds`).
  - Email: Resend via `lib/resend-email.ts` (env-configured).
  - SMS: stored UI/config only (delivery is a no-op placeholder for now).
  - Event + send dedupe: `NotificationEvent` + `NotificationSendLog` models and `lib/notification-center.ts`.
- **Lead scheduler link capture + escalation (Phase 52d)**:
  - Link extraction: `lib/scheduling-link.ts`.
  - Stored on lead: `Lead.externalSchedulingLink` (+ timestamp).
  - Overlap detection + manual task creation: `lib/lead-scheduler-link.ts` (does not auto-book via external scheduler yet).

### Gap summary vs the 5 required processes
- (1) **Supported** via booking-process templates + stage ordering.
- (2) **Owned by Phase 55** (EmailBison first-touch `availability_slot` injection + `Lead.offeredSlots` persistence). Phase 52 must stay compatible.
- (3) **Supported** (high-confidence lead-proposed times → auto-book; otherwise escalation task).
- (4) **Supported** (call task + Notification Center alerting, deduped).
- (5) **Partially supported**: scheduler link capture + overlap detection + escalation task exist; **auto-booking via external scheduler link** remains unresolved.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 51 | Active | Domain: inbound post-processing + prompt runner | Any changes to inbound flows (email/sms/linkedin post-processors) must coordinate with Phase 51’s “inbound kernel” extraction to avoid duplicate logic. |
| Phase 47 | Complete/unknown (check working tree) | UI + schema: `components/dashboard/settings-view.tsx`, `prisma/schema.prisma` | Phase 52d adds Notification Center + Slack integration fields; coordinate/merge carefully to avoid Settings UI conflicts and schema drift. |
| Phase 36 | Complete | Domain: booking-process stages + wave tracking | Reuse existing stage/instruction primitives; do not change wave semantics. |
| Phase 11 | Complete | Domain: Calendly webhook + auto-booking | Keep “accept offered slot” semantics conservative; extend without breaking existing booking evidence. |
| Phase 55 | Complete/unknown (check working tree) | Domain: EmailBison `availability_slot` injection | Phase 52 must stay compatible with `Lead.offeredSlots` populated by Phase 55 (Process 2). |
| Phase 53 | Active/unknown (check working tree) | Domain: webhook stability + timeouts | Call-task creation + notifications must be idempotent and cheap on the inbound/webhook path. |

## Objectives
* [x] Specify the exact end-to-end flows for the 5 booking processes (triggers, data requirements, messages/tasks, booking side effects).
* [x] Identify what is already supported vs missing, with a concrete implementation plan per missing flow.
* [x] Define safe/idempotent automation rules (avoid double-booking, avoid duplicate tasks, avoid unsafe parsing).
* [x] Add a robust Notification Center (per-workspace) to route "positive lead / call requested" alerts to Slack/email/SMS with configurable triggers + destinations.
* [x] Produce a verification runbook and minimal regression coverage for the new flows.

## Constraints
- Preserve existing booking-process wave tracking semantics (Phase 36).
- Preserve existing “auto-book only on clear acceptance” safety posture; ambiguous messages should escalate to a follow-up task (not auto-book).
- Do not add fragile automation that depends on browser scraping of third-party schedulers unless explicitly approved; prefer existing provider/public APIs where available (e.g., Calendly public “booking” endpoints already used for availability).
- Do not log secrets or sensitive lead content beyond what is already considered safe.
- Maintain idempotency across webhook retries/background jobs (no duplicate “call” tasks, no double-booking).
- Notification secrets (e.g., Slack credentials) must be stored server-side and must not be exposed to client components; UI should show masked values only.

## Success Criteria
- (1) For a campaign assigned to a “Link + Qualification” booking process, the AI’s first reply for an interested lead includes: booking link + required qualifying question(s) and **no suggested times**.
- (2) For EmailBison campaigns whose **first outbound email** includes availability via the lead custom variable **exactly** `availability_slot`, we can deterministically choose 2 UTC slots, generate/inject the sentence **~15 minutes before scheduled send** (only when the send is within the next 24 hours), persist those same slots to `Lead.offeredSlots`, and auto-book when the lead picks one.
- (3) If a lead proposes times (not selecting from offered slots), the system can: parse candidate times, check workspace availability, and auto-book a matching time when confidence is high; otherwise it creates a clarification task/message.
- (4) If the lead requests a phone call and provides a phone number, the system creates a “call” follow-up task and sends a client notification via the configured Notification Center destinations (Slack/email/SMS).
- (5) If the lead provides a scheduler link, the system captures it and (when the lead asks us to book via that link) creates a **manual review task** containing the link + any overlap suggestion; fully automated booking via third-party scheduler is **documented as a follow-on** (Playwright/Fly.io) and is not required for Phase 52 ship.
- (N) When Notification Center is configured to alert on “Interested” / other positive sentiments, a new positive lead triggers a notification once (deduped) to the selected destination(s).

## Subphase Index
* a — Requirements + current-state coverage map
* b — Outbound: link-first + qualifying questions; “initial email times” persistence decision
* c — Inbound: auto-book from offered times + lead-proposed times
* d — Inbound: call-me notifications + lead calendar-link scheduling/escalation
* e — Tests, telemetry, and verification runbook

## Repo Reality Check (RED TEAM)

- What exists today:
  - The working tree currently includes Phase 52 implementation changes (schema + settings UI + inbound processors); coordinate with adjacent phases before merging.
  - Sentiment tags include `"Interested"` and `"Call Requested"` (`lib/sentiment-shared.ts`, `lib/sentiment.ts`).
  - Follow-up tasks support `type="call"` (schema: `FollowUpTask.type` is a string; UI already supports tasks).
  - Slack notifications exist in multiple forms:
    - `lib/slack-notifications.ts` uses `SLACK_WEBHOOK_URL` (single global destination).
    - `lib/slack-dm.ts` uses `SLACK_BOT_TOKEN` and DMs by email (internal admin use).
    - Phase 52 adds per-workspace Slack posting via `lib/slack-bot.ts` + `Client.slackBotToken` + `WorkspaceSettings.notificationSlackChannelIds`.
  - Workspace Settings includes Notification Center configuration (per-sentiment rules + recipients) alongside existing coarse toggles.
  - Settings UI (`components/dashboard/settings-view.tsx`) includes Notification Center controls + Slack integration card.
- What the plan assumes:
  - We keep notification delivery idempotent and cheap on webhook paths (timeouts + dedupe; optionally shift realtime delivery to background dispatch).
- Verified touch points:
  - `actions/settings-actions.ts` (workspace settings fetch/update)
  - `actions/slack-integration-actions.ts` (Slack bot token validation + channel listing)
  - `components/dashboard/settings-view.tsx` (Notifications UI + Integrations tab)
  - `lib/followup-engine.ts` (auto-book + existing Slack booking notifications)
  - `lib/notification-center.ts` (rules + dedupe + delivery + daily digest)
  - `lib/call-requested.ts`, `lib/scheduling-link.ts`, `lib/lead-scheduler-link.ts` (call tasks + scheduler link handling)
  - `lib/background-jobs/email-inbound-post-process.ts`, `lib/inbound-post-process/pipeline.ts` (inbound post-processing entrypoints)

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Notification dispatch path is underspecified (inline vs background) → avoid slow webhooks; ensure idempotency + timeouts; wire `processRealtimeNotificationEventsDue()` if we want background delivery.
- Notification spam → dedupe policy must remain enforced (per lead + sentiment + destination + time window).
- Slack failures due to missing scopes / bot membership → must document required scopes + “invite bot to channel” requirement; handle errors without breaking inbound pipeline.
- Process (5) “book on the lead’s scheduler link” is not fully automatable without provider-specific booking APIs (or explicit approval of browser automation) → must ship safe fallback (manual task + overlap) even if auto-book is deferred.

## Open Questions (Need Human Input)

- [x] (Resolved) Process (5) automation scope: Phase 52 ships manual review; full third-party booking automation (Calendly/Cal.com/GHL/HubSpot etc) may require Playwright browser automation on a long-running backend (Fly.io) and will be planned separately.
- [x] (Resolved) Trigger: always capture detected scheduler links; only act (task/escalation/booking) when intent indicates "book via my link".
- [x] (Resolved) Email notifications: use Resend; **per-workspace integration** configured in the Integrations tab (not global env-only).
- [x] (Resolved) Daily digest content: include lead names + links (no cap; chunk if needed); default timezone when unset is EST/ET (`America/New_York`).

## Phase Summary

### Shipped
- **5 Booking Process Templates**: All stakeholder-aligned templates implemented and available for bulk creation
- **Stage Instruction Ordering**: `BookingProcessStage.instructionOrder` field supports questions-first / times-first / link-first
- **Call Requested Tasks**: `lib/call-requested.ts:ensureCallRequestedTask()` creates idempotent call tasks
- **Notification Center**: Full implementation with realtime + daily digest modes, Slack + email delivery, per-sentiment rules
- **Scheduler Link Handling**: Capture, storage, availability overlap detection, manual review task creation
- **Per-Workspace Integrations**: Slack bot token + Resend API stored server-side with masked UI

### Verified
- `npm run lint`: ✅ (0 errors, 18 warnings — pre-existing)
- `npm run build`: ✅
- `npm run db:push`: ✅ (already synced)

### Key Files
- `lib/notification-center.ts` — Notification engine
- `lib/call-requested.ts` — Call task creation
- `lib/scheduling-link.ts` — Scheduler link extraction
- `lib/lead-scheduler-link.ts` — Lead scheduler link handling
- `lib/slack-bot.ts` — Per-workspace Slack API
- `lib/resend-email.ts` — Per-workspace email delivery
- `prisma/schema.prisma` — `NotificationEvent`, `NotificationSendLog`, extended Lead/Client/WorkspaceSettings

### Notes
- SMS delivery is intentionally a no-op placeholder (config-only).
- Third-party scheduler booking automation (Calendly/HubSpot/GHL) documented as a follow-on; Phase 52 ships safe manual review fallback.
- All changes are idempotent and non-blocking on the inbound pipeline path.
