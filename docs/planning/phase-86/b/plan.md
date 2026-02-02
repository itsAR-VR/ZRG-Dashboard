# Phase 86b — Slot Counting Library (Timezone + Business Hours)

## Focus
Implement deterministic counting of availability slots within workspace-local business hours for the next 7 days (weekdays only).

## Inputs
- Existing timezone validation pattern: `lib/auto-send-schedule.ts` uses `Intl.DateTimeFormat` with try/catch for invalid IANA names.
- Provider availability format: `lib/calendar-availability.ts:16-19` — `AvailabilitySlot = { startTime: Date, endTime?: Date }`.
- Workspace settings fields from schema:
  - `timezone` (String?, nullable)
  - `workStartTime` (String? @default("09:00"))
  - `workEndTime` (String? @default("17:00"))

## Work
1. Create `lib/calendar-health.ts` with `"use server"` or `import "server-only"` directive.
2. Export `isValidTimezone(tz: string): boolean`:
   - Use `Intl.DateTimeFormat(undefined, { timeZone: tz })` in try/catch.
3. Export `countSlotsInWorkspaceWindow(opts)` function:
   ```typescript
   interface CountSlotsOptions {
     slots: Date[];                    // Provider slot startTimes (UTC)
     timeZone: string;                 // IANA timezone
     workStartTime: string;            // "HH:mm"
     workEndTime: string;              // "HH:mm"
     windowDays?: number;              // default 7
     weekdaysOnly?: boolean;           // default true
     referenceNow?: Date;              // for testing; defaults to new Date()
   }
   interface CountSlotsResult {
     total: number;
     byDate: Record<string, number>;   // YYYY-MM-DD → count
     windowStart: string;              // YYYY-MM-DD
     windowEnd: string;                // YYYY-MM-DD
   }
   ```
4. Implementation steps:
   - Validate timezone; fall back to `America/New_York` if invalid/missing.
   - Compute "today" in workspace TZ as `windowStart`.
   - Compute `windowEnd` = windowStart + windowDays - 1.
   - For each slot:
     - Convert to workspace-local using `toLocaleString('en-CA', { timeZone })` for date and `toLocaleTimeString('en-GB', { timeZone })` for time.
     - Check if date is within [windowStart, windowEnd].
     - Check if weekday (getDay() in workspace TZ != 0 and != 6).
     - Check if time is within [workStartTime, workEndTime) (compare as HH:mm strings).
     - If all pass, increment `total` and `byDate[date]`.
   - Dedupe slots by `startTime.toISOString()` before counting (providers may return duplicates).
5. Export `DEFAULT_TIMEZONE = "America/New_York"` constant.

## Validation (RED TEAM)
- Add temporary test script or inline test:
  - Slot at 10:00 AM ET on Monday → counted
  - Slot at 10:00 AM ET on Saturday → NOT counted
  - Slot at 6:00 PM ET on Monday → NOT counted (outside 17:00 end)
  - Slot at 9:00 AM ET on Monday → counted (boundary inclusive)
- Verify timezone fallback works for invalid timezone string.

## Output
- Added `lib/calendar-health.ts` with:
  - `CalendarHealthCountResult` (`{ total, byDate }`)
  - `countSlotsInWorkspaceWindow({ slotsUtcIso, timeZone, windowDays, workStartTime, workEndTime, weekdaysOnly, now? })`
  - Built-in IANA timezone validation + fallback to `America/New_York`
  - Slot de-dupe by ISO string before counting

## Handoff
- Proceed to Phase 86c: build the runner that fetches per-`CalendarLink` availability for 7 days, then uses `countSlotsInWorkspaceWindow(...)` with workspace `timezone/workStartTime/workEndTime` and compares to `calendarHealthMinSlots`.

## Assumptions / Open Questions (RED TEAM)
- **Assumption:** Slot `startTime` is the relevant timestamp for counting (not `endTime`) (~98% confidence)
  - Mitigation: If endTime matters, we only count slots where the entire meeting fits in business hours.
- **Assumption:** workStartTime/workEndTime use half-open interval `[start, end)` — 09:00 is included, 17:00 is excluded (~90% confidence)
  - Mitigation: Document behavior clearly; matches typical business hours interpretation.
