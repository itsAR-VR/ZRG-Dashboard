# Phase 67d — Database Preflight Check

## Status: ✅ Already Applied

Phase 67d anticipated schema migrations that were already completed in earlier phases.

### Schema Status

The `AvailabilitySource` enum and related unique constraints are already in production schema:

```sql
-- prisma/schema.prisma (lines 23, 1208, 1224, 1236, 1243, 1246)
enum AvailabilitySource {
  DEFAULT      // Primary booking calendar (with qualification questions)
  DIRECT_BOOK  // Direct-book calendar (no questions)
}

model WorkspaceAvailabilityCache {
  availabilitySource AvailabilitySource @default(DEFAULT)
  @@unique([clientId, availabilitySource])
}

model WorkspaceOfferedSlot {
  availabilitySource AvailabilitySource @default(DEFAULT)
  @@unique([clientId, availabilitySource, slotUtc])
}
```

### Phase 66 Migration Status

Phase 66 follow-up migration was applied in commits:
- `d110f1c` — Initial migration script
- `c7e3bdf` — Bug fixes
- `1efb2a4` — Create Meeting Requested sequence if missing

No additional migration steps required for Phase 67d.

### Cron Status

The availability cron (`/api/cron/availability`) already supports dual sources via `lib/availability-cache.ts`:
- Refreshes `DEFAULT` source using primary booking calendar
- Refreshes `DIRECT_BOOK` source using direct-book calendar (when configured)

## Preflight Checks (For Reference)

If running on a new environment, verify no duplicates before schema push:

```sql
-- Check for duplicate WorkspaceAvailabilityCache entries
SELECT "clientId", "availabilitySource", COUNT(*)
FROM "WorkspaceAvailabilityCache"
GROUP BY "clientId", "availabilitySource"
HAVING COUNT(*) > 1;

-- Check for duplicate WorkspaceOfferedSlot entries
SELECT "clientId", "availabilitySource", "slotUtc", COUNT(*)
FROM "WorkspaceOfferedSlot"
GROUP BY "clientId", "availabilitySource", "slotUtc"
HAVING COUNT(*) > 1;
```

Both queries should return 0 rows.

## Rollback Artifacts

Phase 66 migration created rollback artifacts at:
- Pattern: `scripts/rollback-phase-66g-*.json`
- Use: `npx tsx scripts/migrate-followups-phase-66.ts --rollback <file>`
