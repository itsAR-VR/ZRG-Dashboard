# Phase 90b — CSV Backfill Importer (Idempotent, Interested-Only)

## Focus
Create an importer that backfills "sheet replica" values from the local Founders Club CSV into the DB **safely and idempotently**, without committing PII.

## Inputs
- Local file (ignored): `Founders Club CRM - Founders Club CRM.csv`
- Mapping notes: `docs/planning/phase-82/artifacts/importer-checklist.md`
- Schema from Phase 90a (new fields + `LeadCrmRow`)

## Work
### 1) Implement `scripts/import-founders-club-crm.ts` (tsx)

**Flags:**
- `--clientId <uuid>` (required)
- `--csvPath <path>` (default to local export filename)
- `--dry-run` default; `--apply` to write
- `--fill-blanks-only` default true
- `--only-interested` default true
- `--update-automation` default false (CRM-only by default)

**Idempotency matching order:**
1. Normalized email (primary) — use `lib/lead-matching.ts:normalizeEmail()`
2. Normalized phone — use `lib/phone-utils.ts:normalizePhone()`
3. Normalized LinkedIn URL — use `lib/linkedin-utils.ts:normalizeLinkedinUrl()`

**Interested-only detection:**
Map sheet `Lead Category` values (case-insensitive) to positive sentiment set:
- "Meeting Requested", "Call Requested", "Information Requested", "Interested"
Skip non-positive rows entirely (unless explicitly configured otherwise).

**Backfill writes (fill blanks only):**
- `Lead`: firstName, lastName, email, phone, linkedinUrl, companyName, companyWebsite, jobTitle
- `LeadCrmRow` (upsert by leadId):
  - `interestRegisteredAt` from CSV `DATE` (canonical interest date)
  - `interestCampaignName` from `Campaign`
  - `interestChannel` from `Channel` normalized to `email|sms|linkedin`
  - `interestType` from normalized positive category
  - `leadCategoryOverride` from normalized category
  - `pipelineStatus` from sheet `Lead Status`
  - `leadType`, `applicationStatus`, `notes`

**Follow-up date requested:**
- If CSV has parseable `Follow-up Date Requested`, set `Lead.snoozedUntil` if empty

**Setter columns:**
- Do **NOT** auto-assign from CSV (values are legacy names; roster is shifting per Phase 89)
- Keep assignment editable via the CRM UI dropdown instead

**Memory efficiency:**
- Use streaming CSV parser (`papaparse` with `step` callback) for large files (10k+ rows)

**Logging:**
- Log counts and lead IDs only; no raw names/emails/phones
- Output: `{ matched: N, created: N, updated: N, skipped: N, errors: [] }`

### 2) Document operator runbook
Create `docs/planning/phase-90/artifacts/backfill-runbook.md`:
1. Dry-run first: `npx tsx scripts/import-founders-club-crm.ts --clientId=<uuid> --dry-run`
2. Review output counts
3. Apply on non-production DB first (use staging `DATABASE_URL`)
4. Apply on production: `npx tsx scripts/import-founders-club-crm.ts --clientId=<uuid> --apply`
5. Verify in Prisma Studio: `npm run db:studio`

## Validation (RED TEAM)
- [ ] Script compiles: `npx tsx --check scripts/import-founders-club-crm.ts`
- [ ] Dry-run produces expected counts without DB writes
- [ ] Apply mode is idempotent: running twice produces no additional updates
- [ ] No PII logged to console
- [ ] Large file (10k rows) doesn't crash with OOM

## Pre-Flight Conflict Check
- [ ] Verify normalization utilities exist: `lib/lead-matching.ts:normalizeEmail()`, `lib/phone-utils.ts:normalizePhone()`, `lib/linkedin-utils.ts:normalizeLinkedinUrl()`
- [ ] Verify CSV file location and column headers match expected format

## Output
- Importer script with dry-run/apply modes and idempotency:
  - `scripts/import-founders-club-crm.ts`
  - Streaming CSV parsing with `papaparse` + pause/resume
  - Interested-only filtering (Meeting/Call/Info Requested + Interested)
  - Fill-blanks-only updates for Lead + LeadCrmRow
- Operator runbook created:
  - `docs/planning/phase-90/artifacts/backfill-runbook.md`

## Coordination Notes
**No direct conflicts** in files touched for this subphase.  
**Note:** Uses `normalizeLinkedInUrl` from `lib/linkedin-utils.ts` (function name differs from spec casing).

## Validation Notes
- `npx tsx --check scripts/import-founders-club-crm.ts` failed with EPERM on IPC pipe in this environment (tsx IPC server cannot bind).

## Handoff
Proceed to Phase 90c to ensure `getCrmSheetRows` computes/fills remaining columns live (follow-ups, touch counts, response attribution).
