# Phase 67d — Schema + Migration Rollout

## Focus
Safely apply schema changes (AvailabilitySource + dual caches) and run the Phase 66 follow-up migration with canary + rollback readiness.

## Inputs
- `prisma/schema.prisma`
- `scripts/migrate-followups-phase-66.ts`
- `app/api/cron/availability/route.ts`
- `lib/availability-cache.ts`, `lib/slot-offer-ledger.ts`

## Work
1. **Preflight dedupe checks (production DB)**
   - Run SQL checks for duplicates that would violate new unique constraints:
     - `WorkspaceAvailabilityCache` duplicates on `(clientId, availabilitySource)`
     - `WorkspaceOfferedSlot` duplicates on `(clientId, availabilitySource, slotUtc)`
   - If duplicates exist, create `scripts/dedupe-availability-source-uniques.ts` with `--dry-run`/`--apply` and rollback artifact output.

2. **Apply schema changes**
   - Run `npm run db:push -- --accept-data-loss` after preflight passes.
   - Verify Prisma client generation and composite unique constraints exist.

3. **Phase 66 migration (follow-ups)**
   - Canary: `npx tsx scripts/migrate-followups-phase-66.ts --apply --clientId <uuid>`
   - Validate with Phase 66e queries (instance counts, no Day 1 auto-email).
   - Full run: `npx tsx scripts/migrate-followups-phase-66.ts --apply`
   - Capture rollback artifact path and verify rollback command.

4. **Cron readiness**
   - Confirm `/api/cron/availability` refreshes both `DEFAULT` and `DIRECT_BOOK` sources.
   - Confirm follow-ups cron schedule supports the new timing expectations.

## Output
- `docs/planning/phase-67/d/db-preflight.md` with SQL checks + results.
- Rollback artifact for dedupe (if required) and for follow-up migration.

## Handoff
Phase 67e completes documentation, red-team review, and final release checklist.
