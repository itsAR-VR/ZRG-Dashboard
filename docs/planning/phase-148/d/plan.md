# Phase 148d — Global Backfill (All Clients)

## Focus
Move existing company URLs out of `Lead.linkedinUrl` into `Lead.linkedinCompanyUrl` globally and normalize variants safely, without overwriting existing profile URLs.

## Inputs
- Deployed schema with `linkedinCompanyUrl` + index (Phase 148a)
- Confirmed ingestion no longer writes company URLs to `linkedinUrl` (Phase 148b)
- Runtime guards in place for transition window (Phase 148c)

## Work

### 0. Pre-Backfill Backup (F7 Rollback Strategy)
Before any mutations, capture affected rows for surgical rollback:
```sql
CREATE TABLE _phase148_backfill_backup AS
SELECT id, "linkedinUrl", "linkedinCompanyUrl"
FROM "Lead"
WHERE "linkedinUrl" LIKE '%linkedin.com/company/%'
   OR "linkedinUrl" LIKE '%linkedin.com/company/%';
```
- If issues arise post-backfill, this table allows exact restoration.
- Drop backup table after 7-day observation window with no issues.

### 1. Pre-Backfill Diagnostic Query
Count and enumerate affected rows before mutation:
```sql
SELECT "clientId", COUNT(*) as affected_leads
FROM "Lead"
WHERE "linkedinUrl" IS NOT NULL
  AND ("linkedinUrl" LIKE '%/company/%')
GROUP BY "clientId"
ORDER BY affected_leads DESC;
```
Record totals for post-backfill verification.

### 2. Stage 1 — Safe SQL-Only (Canonical Company URLs)
For rows where `linkedinUrl` matches `https://linkedin.com/company/%`:
- If `linkedinCompanyUrl` is null, copy `linkedinUrl` → `linkedinCompanyUrl`.
- Set `linkedinUrl` to null.
- Run in a transaction. Record affected row counts.

### 3. Stage 2 — Variant Normalization (Batched Script)
Identify non-canonical company URL variants still in `linkedinUrl`:
- `www.linkedin.com/company/...`
- `http://linkedin.com/company/...`
- `linkedin.com/company/.../about`
- `linkedin.com/company/...?trk=...`
- Mobile deep links: `linkedin://company/...`

Run a batched backfill script using `normalizeLinkedInUrlAny` + `classifyLinkedInUrl`:
- Normalize and store in `linkedinCompanyUrl` (fill-only — don't overwrite existing).
- Clear `linkedinUrl` if classified as company-kind.
- **Batch size:** 500 leads per batch with 100ms delay between batches to avoid lock contention.
- **Resumability:** Use cursor-based pagination with checkpoint logging (last processed `Lead.id`).
- **Timing:** Run during low-traffic window or with advisory lock.

### 4. Post-Backfill Verification
Assertion query — must return 0:
```sql
SELECT COUNT(*) FROM "Lead"
WHERE "linkedinUrl" IS NOT NULL
  AND "linkedinUrl" LIKE '%/company/%';
-- Expected: 0
```

Profile URLs must remain intact:
```sql
SELECT COUNT(*) FROM "Lead"
WHERE "linkedinUrl" IS NOT NULL
  AND "linkedinUrl" LIKE '%/in/%';
-- Expected: unchanged from pre-backfill count
```

Spot-check Tim Blais workspace as sentinel:
```sql
SELECT id, "linkedinUrl", "linkedinCompanyUrl"
FROM "Lead"
WHERE "clientId" = '779e97c3-e7bd-4c1a-9c46-fe54310ae71f'
  AND ("linkedinCompanyUrl" IS NOT NULL OR "linkedinUrl" LIKE '%/company/%');
```

## Output
- Backfill executed across all clients with auditable counts and spot checks.
- Tim Blais workspace no longer has `Lead.linkedinUrl` set to `company/...` for any leads.
- Backup table created for 7-day rollback window.

## Handoff
Proceed to Phase 148e to run validation gates, replay checks, and a production rollout verification checklist.
