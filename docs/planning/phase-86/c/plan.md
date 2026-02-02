# Phase 86c — Calendar Health Runner (Fetch + Evaluate Per CalendarLink)

## Focus
Fetch availability for each workspace's calendar links (next 7 days) and evaluate whether each link meets the workspace's minimum-slot threshold in business hours.

## Inputs
- Provider availability functions in `lib/calendar-availability.ts`:
  - `detectCalendarType(url)` at line 38
  - `fetchCalendlyAvailabilityWithMeta(url, days)` at line 258 → returns `{ slots, calendarName, ... }`
  - `fetchGHLAvailabilityWithMeta(url, days)` at line 511 → returns `{ slots, calendarName, ... }`
  - `fetchHubSpotAvailability(url, days)` at line 409 → returns `AvailabilitySlot[]`
- `CalendarLink` model: `id`, `clientId`, `name`, `url`, `type`, `isDefault`
- Counting utility: `countSlotsInWorkspaceWindow()` from Phase 86b

## Work
1. Create `lib/calendar-health-runner.ts` (server-only).
2. Export `runCalendarHealthCheck(opts)`:
   ```typescript
   interface RunnerOptions {
     clientId?: string;              // Optional: single workspace debug mode
     timeBudgetMs?: number;          // Default 45_000 (45s)
     concurrency?: number;           // Default 3
   }
   interface CalendarHealthResult {
     clientId: string;
     clientName: string;
     slackBotToken: string | null;
     slackChannelIds: string[];
     slackAlertsEnabled: boolean;
     timezone: string;               // Resolved (with fallback)
     workStartTime: string;
     workEndTime: string;
     threshold: number;
     calendars: CalendarLinkResult[];
     errors: string[];
   }
   interface CalendarLinkResult {
     calendarLinkId: string;
     calendarName: string;
     calendarUrl: string;
     calendarType: string;
     slotCount: number;
     byDate: Record<string, number>;
     isBelowThreshold: boolean;
     error?: string;
   }
   ```
3. Query eligible workspaces:
   ```sql
   SELECT c.id, c.name, c.slackBotToken,
          ws.calendarHealthEnabled, ws.calendarHealthMinSlots,
          ws.timezone, ws.workStartTime, ws.workEndTime,
          ws.slackAlerts, ws.notificationSlackChannelIds
   FROM Client c
   JOIN WorkspaceSettings ws ON ws.clientId = c.id
   WHERE ws.calendarHealthEnabled = true
     AND (clientId IS NULL OR c.id = :clientId)  -- debug mode filter
   ```
4. For each workspace, query `CalendarLink` rows:
   ```sql
   SELECT id, name, url, type FROM CalendarLink WHERE clientId = :clientId AND url != ''
   ```
5. For each CalendarLink with non-empty URL:
   - Resolve `type` via stored value or `detectCalendarType(url)`.
   - Use Promise.race with 10s timeout per fetch.
   - Handle fetch errors gracefully: log error, set `CalendarLinkResult.error`, continue.
   - Extract `slots: AvailabilitySlot[]` → map to `Date[]` via `slot.startTime`.
   - Call `countSlotsInWorkspaceWindow({ slots, timeZone, workStartTime, workEndTime })`.
   - Set `isBelowThreshold = count.total < threshold`.
6. Track cumulative time; stop processing if `timeBudgetMs` exceeded.
7. Return array of `CalendarHealthResult`.

## Validation (RED TEAM)
- Test with a workspace having multiple CalendarLinks (Calendly + GHL).
- Test single-workspace debug mode with `clientId` param.
- Verify timeout handling: slow provider doesn't block others.
- Verify empty URL CalendarLinks are skipped.

## Output
- Added `lib/calendar-health-runner.ts` with `runCalendarHealthChecks(...)` which:
  - Loads `Client` + `WorkspaceSettings` + all `CalendarLink`s
  - Fetches provider availability per link for `windowDays` (default 7)
  - Counts slots in workspace-local business hours using `countSlotsInWorkspaceWindow(...)`
  - Flags when `count.total < calendarHealthMinSlots`
  - Supports `clientId` (single-workspace debug) and bounded concurrency/time budget
- Returns per-workspace structured results (`workspaces[]`) ready for Slack notification in Phase 86d.

## Handoff
- Proceed to Phase 86d: iterate `workspaces[].calendarLinks[]` and post Slack alerts for `flagged === true` links, using NotificationSendLog for weekly dedupe.

## Assumptions / Open Questions (RED TEAM)
- **Assumption:** HubSpot availability fetch uses same `days` parameter as Calendly/GHL (~95% confidence)
  - Verified: `fetchHubSpotAvailability(url, days)` at line 409.
- **Assumption:** CalendarLinks with empty `url` should be skipped silently (no error) (~95% confidence)
  - Mitigation: Log at debug level; don't count as error.
- **Assumption:** Concurrency of 3 parallel fetches is safe for provider rate limits (~85% confidence)
  - Mitigation: Can reduce to 2 if rate limit errors observed.
