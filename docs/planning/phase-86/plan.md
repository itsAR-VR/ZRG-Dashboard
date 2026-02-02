# Phase 86 — Weekly Calendar Slot Health Check (Slack Alerts)

## Purpose
Add a weekly automated check that counts each client’s available booking slots during workspace-local business hours (9am–5pm by default) for the next 7 days, and flags low availability to us via the workspace’s Slack channels.

## Context
- Today, a client’s booking calendar can silently drift into “almost no good slots”, which reduces booked meetings because prospects can’t find acceptable times.
- The repo already has:
  - Provider availability fetchers (`lib/calendar-availability.ts`) and an availability cache (`lib/availability-cache.ts`) primarily focused on “show a few slots” and follow-up automation.
  - Per-workspace Slack configuration (`Client.slackBotToken`, `WorkspaceSettings.notificationSlackChannelIds`, `WorkspaceSettings.slackAlerts`) and a Slack API wrapper (`lib/slack-bot.ts`).
  - Cron/auth patterns (`CRON_SECRET`, advisory locks) under `app/api/cron/**`.
- This feature does **not** require an LLM; slot counting is deterministic. “AI” here means “automated”.
- Requirements locked in this conversation:
  - Check **all active** `CalendarLink`s per client (not only `isDefault`).
  - Count slots in the next **7 days**, **weekdays only**, within the workspace’s timezone and `workStartTime`/`workEndTime`.
  - Alert via **per-workspace Slack channels** (not the global Slack webhook), and **only** when below threshold.
  - Threshold is a **workspace setting** (default 10).
  - Weekly run time: **Sunday 6:00pm America/New_York**.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 85 | Untracked (working tree) | `prisma/schema.prisma` (WorkspaceSettings additions) | Merge schema edits cleanly before adding Phase 86 settings fields. |
| Phase 83 | Uncommitted (working tree) | `prisma/schema.prisma` (active edits) | Treat schema as unstable until Phase 83 changes are committed/merged; re-read schema before editing. |
| Phase 81 | Uncommitted (working tree) | `components/dashboard/settings-view.tsx`, Slack settings | Avoid UI merge conflicts in Settings; prefer additive UI section in Booking tab. |
| Phase 80 | Uncommitted (working tree) | `components/dashboard/settings-view.tsx`, timezone/business-hours patterns | Reuse existing timezone validation patterns; coordinate Settings UI edits. |
| Phase 78 | Complete (per phase docs) | Cron auth/lock resilience patterns | Reuse cron authorization + advisory lock patterns for the new endpoint. |

## Objectives
* [x] Add workspace settings to enable/disable calendar health checks and configure min slots threshold.
* [x] Implement deterministic counting of availability slots within workspace-local business hours for the next 7 days.
* [x] Evaluate all calendar links per workspace and send deduped Slack alerts when below threshold.
* [x] Add a weekly cron endpoint (ET anchored) and wire it into `vercel.json`.
* [x] Add tests + a small verification runbook.

## Constraints
- **Security:** Cron endpoints must require `Authorization: Bearer <CRON_SECRET>` and validate before processing.
- **Multi-tenant:** Alerts must use the workspace’s configured Slack bot token and channel list; no cross-workspace leakage.
- **Timezones:** Use IANA timezone names (`America/New_York`, etc.). If missing/invalid, fall back safely (ET).
- **Week definition:** “Next 7 days” is a rolling window from `now` in workspace timezone; weekends excluded.
- **Idempotency:** Avoid duplicate weekly Slack alerts for the same workspace/calendar/channel (cron retries happen).
- **Prisma:** If `prisma/schema.prisma` changes, run `npm run db:push` before considering implementation done.

## Success Criteria
- [x] A weekly run produces Slack alerts only for workspaces/calendars under the configured threshold.
- [x] Alerts include the counted total and identify which calendar link is low.
- [x] Workspace admins can enable/disable the check and set the threshold in Settings.
- [x] Dedupe prevents repeated alerts within the same week for the same calendar link + channel.
- [x] Validation passes: `npm run test`, `npm run lint`, `npm run build` (and `npm run db:push` if schema changed).

## Subphase Index
* a — Schema + WorkspaceSettings fields
* b — Slot counting library (TZ + business hours)
* c — Calendar health runner (fetch + evaluate per CalendarLink)
* d — Slack alerting + dedupe (per workspace channels)
* e — Cron endpoint + Vercel schedule (ET anchored weekly)
* f — Settings UI + tests + verification checklist

## Repo Reality Check (RED TEAM)

### What exists today
- **Calendar availability fetchers:** `lib/calendar-availability.ts` — exports `detectCalendarType()`, `fetchCalendlyAvailabilityWithMeta()`, `fetchGHLAvailabilityWithMeta()`, `fetchHubSpotAvailability()` with return type `AvailabilitySlot[]` (`{ startTime: Date, endTime?: Date }`)
- **Availability cache:** `lib/availability-cache.ts` — exports `refreshAvailabilityCachesDue()` for cron-driven cache refresh
- **Slack posting:** `lib/slack-bot.ts:187` — exports `slackPostMessage({ token, channelId, text, blocks? })`
- **Dedupe model:** `prisma/schema.prisma:871` — `NotificationSendLog` with unique `dedupeKey`, used for `kind = "sentiment_realtime" | "daily_digest"`; plan extends to `"calendar_health_weekly"`
- **WorkspaceSettings fields:** `timezone` (String?), `workStartTime` (String? @default("09:00")), `workEndTime` (String? @default("17:00")), `slackAlerts` (Boolean @default(true)), `notificationSlackChannelIds` (String[] @default([]))
- **Client.slackBotToken:** `prisma/schema.prisma:164` — per-workspace Slack bot token
- **CalendarLink model:** `prisma/schema.prisma:1285` — `id`, `clientId`, `name`, `url`, `type`, `isDefault`
- **Cron auth pattern:** `app/api/cron/availability/route.ts:10-22` — `isAuthorized()` checks `Authorization: Bearer ${CRON_SECRET}` + `x-cron-secret` fallback
- **Advisory lock pattern:** `app/api/cron/availability/route.ts:24-33` — `tryAcquireLock()` + `releaseLock()` with `pg_try_advisory_lock()`
- **Timezone validation:** `lib/auto-send-schedule.ts` — uses `Intl.DateTimeFormat` for timezone validation (pattern to reuse)
- **Vercel crons:** `vercel.json` — 8 cron entries; new entry will be added

### What the plan assumes
- `calendarHealthEnabled` / `calendarHealthMinSlots` fields do NOT exist yet — Phase 86a creates them
- `lib/calendar-health.ts` does NOT exist yet — Phase 86b creates it
- `lib/calendar-health-runner.ts` does NOT exist yet — Phase 86c creates it
- Cron endpoint at `/api/cron/calendar-health` does NOT exist yet — Phase 86e creates it

### Verified touch points
- `fetchCalendlyAvailabilityWithMeta` at `lib/calendar-availability.ts:258`
- `fetchGHLAvailabilityWithMeta` at `lib/calendar-availability.ts:511`
- `fetchHubSpotAvailability` at `lib/calendar-availability.ts:409`
- `slackPostMessage` at `lib/slack-bot.ts:187`
- `NotificationSendLog` at `prisma/schema.prisma:871`
- `CalendarLink` at `prisma/schema.prisma:1285`
- `WorkspaceSettings` at `prisma/schema.prisma:274` (line range approx)
- `isAuthorized` pattern at `app/api/cron/availability/route.ts:10`
- `tryAcquireLock` pattern at `app/api/cron/availability/route.ts:26`

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Provider fetch timeout:** `fetchCalendlyAvailabilityWithMeta()` and friends can take 5-10s per calendar; with many CalendarLinks, cumulative time exceeds Vercel maxDuration → **Mitigation:** Add per-fetch timeout (10s), bounded concurrency (3), and cumulative time budget (45s) in Phase 86c; skip remaining calendars and log when budget exhausted.
- **NotificationSendLog kind mismatch:** Plan introduces `kind = "calendar_health_weekly"` but existing `kind` column has no enum constraint; fine at Prisma level, but document expected values → **Mitigation:** Add comment to schema and plan clarifying valid `kind` values.
- **Empty CalendarLink URL:** Some `CalendarLink` rows may have empty `url` (created by accident or placeholder) → **Mitigation:** Phase 86c must filter for non-empty `url` before fetching.

### Missing or ambiguous requirements
- **"All active CalendarLinks":** Plan says "all active" but no `isActive` field exists on `CalendarLink`. The model has `isDefault` but no disabled flag. → **Clarification:** Treat all CalendarLinks with non-empty `url` as active (no explicit enable/disable field). Document this interpretation.
- **Slot deduplication:** Provider APIs may return overlapping or duplicate slots → **Mitigation:** Phase 86b should dedupe slots by `startTime` before counting.
- **Settings UI tab location:** Plan says "Booking tab" but doesn't specify exact placement → **Clarification:** Add in the Booking tab's "Availability Settings" section, after existing calendarSlotsToShow/calendarLookAheadDays fields.
- **Threshold validation range:** Plan says "integer ≥ 0" but no upper bound → **Mitigation:** Clamp to 0-100 in settings action (100 slots is generous for a 7-day window).

### Repo mismatches (fixed)
- Plan references `actions/settings-actions.ts` — verified exists at correct path ✓
- Plan references `components/dashboard/settings-view.tsx` — verified exists ✓
- Plan says "Booking tab" — verified Settings has Booking tab UI structure ✓

### Performance / timeouts
- **Vercel maxDuration:** Cron route must set `maxDuration = 60` (matching availability cron) to avoid premature timeout.
- **Concurrent workspace processing:** Running all workspaces serially risks timeout; use limited parallelism (batch of 5 workspaces at a time).
- **Rate limiting on Slack API:** Slack has rate limits (~1 msg/sec/channel); add small delay (200ms) between Slack posts in Phase 86d.

### Security / permissions
- **Cron auth:** Plan correctly requires `CRON_SECRET` check — verified pattern exists ✓
- **Multi-tenant isolation:** Each workspace uses own `slackBotToken` — plan correctly specifies ✓
- **Settings update gating:** calendarHealth settings should be admin-gated (like other notification settings) → **Mitigation:** Add `requireClientAdminAccess()` check for these fields in Phase 86f.

### Testing / validation
- **Unit tests for timezone edge cases:** Must cover DST transitions, invalid timezone fallback, and boundary times (exactly at workStartTime/workEndTime).
- **Manual verification checklist:** Add to Phase 86f with explicit steps for triggering via `?clientId=...` debug mode.

### Multi-agent coordination
- **Phase 83 schema conflict:** Phase 83 (CRM Analytics) has uncommitted `prisma/schema.prisma` changes (`LeadCrmRow` model, CRM fields). Phase 86a must merge cleanly with Phase 83 schema work. → **Resolution:** Re-read schema immediately before editing; add new fields after existing WorkspaceSettings fields (line ~298).
- **Phase 89 schema conflict:** Phase 89 (Round-Robin) plans to add `roundRobinSetterSequence` / `roundRobinEmailOnly` fields to WorkspaceSettings. If Phase 89 executes first, Phase 86a must merge cleanly. → **Resolution:** Add Phase 86 fields at a distinct location (after calendar settings, before any Phase 89 fields).
- **Settings UI overlap:** Phases 80, 81, 86, 88 all touch `components/dashboard/settings-view.tsx`. → **Resolution:** Phase 86 adds a self-contained subsection; avoid refactoring existing code.

## Assumptions (Agent)

- **Assumption:** `CalendarLink` rows with non-empty `url` are considered "active" (no explicit enable/disable flag exists) (~95% confidence)
  - Mitigation: If a disable flag is added later, Phase 86c can filter by it.

- **Assumption:** Provider availability fetches return slots in ascending order by `startTime` (~90% confidence)
  - Mitigation: Sort slots before counting if order is not guaranteed.

- **Assumption:** Sunday 6:00pm ET is a good time for weekly alerts (gives workspace admins the evening to review before Monday) (~85% confidence)
  - Mitigation: This is configurable if needed in a future phase (time setting per workspace).

- **Assumption:** 10 slots is a reasonable default minimum threshold (~80% confidence)
  - Mitigation: Default is easily adjusted in schema and UI.

## Resolved Questions

- [x] **Default threshold?** — **10 slots** (default; workspace-configurable)
- [x] **Alert format?** — **Only flags** (send only when below threshold)
- [x] **Calendars checked?** — **All CalendarLinks with non-empty URL**
- [x] **Window rules?** — **Workspace timezone + workStart/workEnd; weekdays only**

## Phase Summary

### What shipped
- Weekly calendar health check across all `CalendarLink`s, counting slots during workspace-local business hours for the next 7 days.
- Per-workspace Slack alerts (Notification Center channels) with weekly dedupe via `NotificationSendLog`.
- Admin-configurable workspace settings: enable/disable + min slots threshold.

### Key files
- Schema: `prisma/schema.prisma` (adds `calendarHealthEnabled`, `calendarHealthMinSlots` to `WorkspaceSettings`)
- Counting: `lib/calendar-health.ts`
- Runner: `lib/calendar-health-runner.ts`
- Slack alerts: `lib/calendar-health-notifications.ts`
- Cron route: `app/api/cron/calendar-health/route.ts`
- Vercel schedule: `vercel.json`
- Settings wiring/UI: `actions/settings-actions.ts`, `components/dashboard/settings-view.tsx`
- Tests: `lib/__tests__/calendar-health.test.ts`

### Verification
- `npm run db:push` (schema synced)
- `npm test`
- `npm run lint` (warnings only)
- `npm run build`
