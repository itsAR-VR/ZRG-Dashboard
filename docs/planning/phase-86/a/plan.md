# Phase 86a — Schema + WorkspaceSettings Fields

## Focus
Add workspace-level configuration for the weekly calendar availability health check: enable/disable toggle and minimum-slot threshold.

## Inputs
- Phase 86 root requirements (weekly ET run; weekdays only; per-workspace Slack).
- Existing `WorkspaceSettings` fields: `timezone`, `workStartTime`, `workEndTime` (lines ~295-297).
- Current working tree includes active edits to `prisma/schema.prisma` (Phase 83 CRM additions); schema must be re-read before editing.

## Work
1. **Re-read** `prisma/schema.prisma` to capture any concurrent changes (Phase 83, Phase 89).
2. Add fields to `WorkspaceSettings` in `prisma/schema.prisma` after the calendar settings section (after `calendarLookAheadDays`, approx line 301):
   ```prisma
   // Calendar Health Check (Phase 86)
   calendarHealthEnabled   Boolean  @default(true)
   calendarHealthMinSlots  Int      @default(10)
   ```
3. Ensure defaults match requirements:
   - `calendarHealthEnabled = true` (enabled-by-default)
   - `calendarHealthMinSlots = 10` (default threshold)
4. Run `npm run db:push` against the database using `DIRECT_URL` and verify columns exist.
5. Verify Prisma client regenerates on next build/dev start.
6. **Do NOT** update settings actions in this subphase — wiring happens in Phase 86f.

## Validation (RED TEAM)
- `npm run db:push` exits 0
- Open Prisma Studio (`npm run db:studio`) and verify `WorkspaceSettings` table has new columns with correct defaults
- Run `npx prisma generate` and verify no TypeScript errors on import

## Output
- Updated `WorkspaceSettings` in `prisma/schema.prisma` with:
  - `calendarHealthEnabled Boolean @default(true)`
  - `calendarHealthMinSlots Int @default(10)`
- Ran `npm run db:push` successfully (Supabase Postgres synced).
- Ran `npx prisma generate` successfully (Prisma Client regenerated with the new fields).

## Coordination Notes
**File overlap:** `prisma/schema.prisma` already had active edits in the working tree (Phase 83/CRM).  
**Resolution:** Added Phase 86 fields as a small, isolated block under the existing “Calendar Settings” section to avoid conflicting with other schema edits.

## Handoff
- Proceed to Phase 86b: implement deterministic slot counting in `lib/calendar-health.ts` (timezone + business-hours window), and add unit tests later in Phase 86f.

## Assumptions / Open Questions (RED TEAM)
- **Assumption:** Phase 83 schema changes (LeadCrmRow, CRM fields) will be merged before or cleanly alongside Phase 86a (~90% confidence)
  - Mitigation: Re-read schema before editing; add fields in a distinct section.
