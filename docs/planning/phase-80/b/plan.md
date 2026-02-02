# Phase 80b — Schema: AutoSendScheduleMode Enum and Fields

## Focus

Add database schema fields to support configurable auto-send timing modes at both workspace and campaign levels.

## Inputs

- Phase 80a complete (draft generation bug fixed)
- Current schema: `WorkspaceSettings` and `EmailCampaign` models in `prisma/schema.prisma`

## Work

1. **Add enum to schema:**
   ```prisma
   enum AutoSendScheduleMode {
     ALWAYS          // 24/7 (current behavior)
     BUSINESS_HOURS  // Use workspace workStartTime/workEndTime, exclude weekends
     CUSTOM          // Use detailed custom schedule JSON
   }
   ```

2. **Add fields to WorkspaceSettings:**
   ```prisma
   autoSendScheduleMode     AutoSendScheduleMode @default(ALWAYS)
   autoSendCustomSchedule   Json?
   ```

   Custom schedule JSON structure:
   ```json
   {
     "days": [1, 2, 3, 4, 5],
     "startTime": "08:00",
     "endTime": "18:00"
   }
   ```

3. **Add fields to EmailCampaign (per-campaign override):**
   ```prisma
   autoSendScheduleMode     AutoSendScheduleMode?
   autoSendCustomSchedule   Json?
   ```
   Note: Nullable fields mean "inherit from workspace"

4. **Apply migration:**
   ```bash
   npm run db:push
   ```

5. **Verify:**
   - `npm run lint`
   - `npm run build`
   - Check Prisma Studio for new fields

## Output

- Added `AutoSendScheduleMode` enum and schedule fields in `prisma/schema.prisma` for `WorkspaceSettings` + `EmailCampaign`.
- Ran `npm run db:push` (Prisma schema synced successfully).
- Prisma client regenerated via `db:push`.

## Handoff

With schema in place, proceed to Phase 80c to implement the schedule checking utility library.
