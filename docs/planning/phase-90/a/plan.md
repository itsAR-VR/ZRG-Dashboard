# Phase 90a — Schema + Contracts for Editable CRM Columns

## Focus
Add the minimal Prisma fields needed to support a fully-filled CRM sheet view with spreadsheet editing, without mixing "automation truth" with "CRM display overrides".

## Inputs
- Phase 83 schema additions: `LeadCrmRow`, `CrmResponseMode`
- Founders Club sheet columns (Phase 82 inventory; `Founders Club CRM.xlsx` headers)
- Current CRM query mapping: `actions/analytics-actions.ts:getCrmSheetRows`

## Work
### 1) Update `prisma/schema.prisma`
- **Add `Lead.jobTitle String?`** after `phone` (around line 381):
  ```prisma
  jobTitle     String?   // Job title (CRM sheet "Job Title")
  ```
- **Add to `LeadCrmRow` model** (after `leadIntentScoreAtInterest`, around line 541):
  ```prisma
  // CRM editable display fields
  leadType              String?   // Sheet "Lead Type"
  applicationStatus     String?   // Sheet "Application Status"
  leadCategoryOverride  String?   // Overrides interestType for CRM display; null = use interestType
  ```
- **Add index** for leadCategoryOverride queries:
  ```prisma
  @@index([leadCategoryOverride])
  ```

### 2) Confirm existing fields coverage
- `LeadCrmRow.pipelineStatus` — exists at line 548 ✅
- `LeadCrmRow.interestCampaignName` — exists at line 532 ✅
- `LeadCrmRow.notes` — exists at line 545 ✅

### 3) Update TypeScript contracts
- **File:** `actions/analytics-actions.ts`
- **Update `CrmSheetRow` interface** (lines 111-149):
  - REMOVE: `rollingMeetingRequestRate`, `rollingBookingRate`
  - KEEP: all other fields
  - Fields remain nullable for backward compatibility during migration

### 4) Run schema sync
```bash
npm run db:push
```

## Validation (RED TEAM)
- [ ] `prisma/schema.prisma` compiles without errors: `npx prisma validate`
- [ ] `npm run db:push` succeeds
- [ ] TypeScript compiles: `npm run build` (may have lint warnings until 90c updates queries)
- [ ] Prisma Studio shows new fields: `npm run db:studio`

## Pre-Flight Conflict Check
- [ ] Re-read `prisma/schema.prisma` to confirm insertion points (Phase 83/85/89 may have modified)
- [ ] Re-read `actions/analytics-actions.ts` to confirm CrmSheetRow line numbers

## Output
- Prisma schema updated:
  - `Lead.jobTitle` added.
  - `LeadCrmRow.leadType`, `LeadCrmRow.applicationStatus`, `LeadCrmRow.leadCategoryOverride` added.
  - `@@index([leadCategoryOverride])` added.
- `CrmSheetRow` contract updated to remove rolling rate fields.
- `npm run db:push` executed successfully (DB in sync).

## Coordination Notes
**Conflicts detected:** `prisma/schema.prisma`, `actions/analytics-actions.ts` already modified in working tree (Phase 83/88/89).  
**Resolution:** Applied additive fields only; no destructive edits. Re-read current file state before patching.

## Handoff
Proceed to Phase 90b to build the idempotent CSV backfill importer (dry-run first).
