# Phase 80c — Library: auto-send-schedule.ts Utility

## Focus

Create a new utility library for checking and computing auto-send schedule windows.

## Inputs

- Phase 80b complete (schema fields exist)
- Existing timezone helpers in `lib/followup-engine.ts` (lines 229-293)
- Existing business hours logic pattern

## Work

1. **Create new file:** `lib/auto-send-schedule.ts`

2. **Define types:**
   ```typescript
   export type AutoSendScheduleMode = "ALWAYS" | "BUSINESS_HOURS" | "CUSTOM";

   export interface AutoSendCustomSchedule {
     days: number[];        // 0=Sunday, 1=Monday, ..., 6=Saturday
     startTime: string;     // "HH:MM"
     endTime: string;       // "HH:MM"
     timezone?: string;     // Optional override
   }

   export interface AutoSendScheduleConfig {
     mode: AutoSendScheduleMode;
     timezone: string;
     workStartTime: string;
     workEndTime: string;
     customSchedule: AutoSendCustomSchedule | null;
   }

   export interface AutoSendScheduleCheckResult {
     withinSchedule: boolean;
     reason: string;
     nextWindowStart?: Date;
   }
   ```

3. **Implement core functions:**
   - `resolveAutoSendScheduleConfig(workspace, campaign)` — resolve effective config with campaign override
   - `isWithinAutoSendSchedule(config, now?)` — check if current time is within window
   - `getNextAutoSendWindow(config, now?)` — calculate next valid window start

4. **Port timezone helpers** from `lib/followup-engine.ts`:
   - `safeTimeZone()` — validate timezone with fallback
   - `getZonedDateTimeParts()` — get hour/minute/dayOfWeek in timezone

5. **Handle edge cases:**
   - Weekend detection (Saturday = 6, Sunday = 0)
   - Cross-midnight windows (e.g., night shift: 22:00-06:00)
   - DST transitions

6. **Verify:**
   - `npm run lint`
   - `npm run build`

## Output

- Added `lib/auto-send-schedule.ts` with schedule config resolution + window checks.
- Implemented helper logic for timezone-safe window calculations (BUSINESS_HOURS + CUSTOM + overnight windows).
- Exports: `resolveAutoSendScheduleConfig`, `isWithinAutoSendSchedule`, `getNextAutoSendWindow`.

## Handoff

With schedule utilities ready, proceed to Phase 80d to integrate into the auto-send orchestrator.
