# Founders Club CRM Backfill Runbook

## Preconditions
- Confirm `DATABASE_URL` points to the target database (start with staging).
- Ensure the CSV export is available locally (default: `Founders Club CRM - Founders Club CRM.csv`).
- Confirm the `clientId` (workspace UUID) you intend to backfill.

## 1) Dry-run (required)
```bash
npx tsx scripts/import-founders-club-crm.ts --clientId=<uuid> --dry-run
```

Expected output:
- Matched: N existing leads
- Created: N new leads
- Updated: N existing leads
- Skipped: N rows (non-positive or missing identifiers)
- Errors: 0

## 2) Review output
- Validate counts: matched / created / updated / skipped / errors.
- If `skippedMissingIdentifier` is high, inspect the CSV headers/values locally.
- If errors exist, re-run after resolving (no PII should be logged).

## 3) Apply to staging
```bash
npx tsx scripts/import-founders-club-crm.ts --clientId=<uuid> --apply
```

## 4) Apply to production
```bash
npx tsx scripts/import-founders-club-crm.ts --clientId=<uuid> --apply
```

## 5) Verify in Prisma Studio
```bash
npm run db:studio
```

Verification checklist:
1. Open `LeadCrmRow` and confirm:
   - `interestRegisteredAt` populated
   - `leadCategoryOverride` populated
   - `pipelineStatus`, `leadType`, `applicationStatus` populated where expected
2. Open `Lead` and confirm:
   - `jobTitle` populated where CSV had values
   - `snoozedUntil` set when Follow-up Date Requested was present

## Notes
- The importer is idempotent (running twice should not change counts).
- By default it only imports "Interested"-class leads (Meeting/Call/Info Requested + Interested).
- Use `--csvPath` to point to a non-default export file.
