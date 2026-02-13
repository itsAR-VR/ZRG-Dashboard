# Phase 151a — Prod DB Migration + Compatibility Preflight

## Focus
Align production schema with the required LinkedIn split + SMS audit fields so code can safely read/write the new columns without runtime crashes.

## Inputs
- `docs/planning/phase-151/plan.md`
- Prod schema reality (Supabase MCP): `Lead.linkedinCompanyUrl` is missing in prod today.
- Tim canary identifiers:
  - `clientId = 779e97c3-e7bd-4c1a-9c46-fe54310ae71f`

## Work
1. **Preflight: verify current prod columns**
   - Query `information_schema.columns` for `"Lead"` to confirm which columns exist.
   - Confirm no conflicting columns/names already exist.

2. **Apply prod migrations (must land before code deploy)**
   - Add `Lead.linkedinCompanyUrl text NULL`.
   - Add Lead-level SMS audit columns:
     - `smsLastBlockedAt timestamp NULL`
     - `smsLastBlockedReason text NULL`
     - `smsConsecutiveBlockedCount integer NOT NULL DEFAULT 0`
     - `smsLastSuccessAt timestamp NULL`
   - Add a partial index for `linkedinCompanyUrl` (recommended):
     - `WHERE linkedinCompanyUrl IS NOT NULL`
   - If the migration runner cannot use `CREATE INDEX CONCURRENTLY`, split into two migrations:
     - DDL for columns (transactional)
     - Index creation (manual/admin runbook step)

3. **Update Prisma schema + runtime guards**
   - Ensure `prisma/schema.prisma` matches prod columns.
   - Ensure any code paths referencing the new columns are only deployed after migration.

4. **Verify post-migration**
   - Re-run `information_schema.columns` to confirm columns exist.
   - Smoke query:
     - `SELECT count(*) FROM "Lead" WHERE "linkedinCompanyUrl" IS NOT NULL;` (should be 0 before backfill).

## Output
- Prod DB has the new columns and (where possible) the index.
- Prisma schema is aligned, and deployment order is documented (migration first).

## Handoff
Proceed to 151b once the migration is confirmed in prod; only then is it safe to deploy ingestion/runtime code that writes `linkedinCompanyUrl` or the SMS audit fields.
