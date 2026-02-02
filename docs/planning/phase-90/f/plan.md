# Phase 90f — Tests + QA Runbook + Verification

## Focus
Validate correctness and prevent regressions across import, computed columns, and editing.

## Inputs
- Changes from Phases 90a–90e
- Existing test harness: `npm run test` (tsx orchestrator at `scripts/test-orchestrator.ts`)

## Work
### 1) Add unit tests

**File:** `lib/__tests__/crm-sheet.test.ts`

**Test cases:**
```ts
describe('CRM Sheet', () => {
  describe('Status mapping', () => {
    it('maps "Qualified" to Lead.status = "qualified"', ...);
    it('maps "Meeting Booked" to Lead.status = "meeting-booked"', ...);
    it('maps unknown values to "new"', ...);
  });

  describe('Category mapping', () => {
    it('maps "Meeting Requested" to Lead.sentimentTag', ...);
    it('handles case-insensitive matching', ...);
  });

  describe('updateCrmSheetCell validation', () => {
    it('rejects duplicate email', ...);
    it('normalizes phone numbers', ...);
    it('rejects unauthorized access', ...);
    it('rejects stale edits', ...);
  });

  describe('getCrmSheetRows computed columns', () => {
    it('computes stepResponded from outbound count before interest', ...);
    it('computes followUp1-5 from pending FollowUpTasks', ...);
    it('computes responseStepComplete from outbound after interest', ...);
    it('computes responseMode from first outbound after interest', ...);
    it('returns null for leads with no outbound after interest', ...);
  });
});
```

**CRITICAL:** Register test file in `scripts/test-orchestrator.ts`:
```ts
const TEST_FILES = [
  // ... existing files
  'lib/__tests__/crm-sheet.test.ts',
];
```

### 2) Importer verification runbook

**File:** `docs/planning/phase-90/artifacts/backfill-runbook.md`

```markdown
# CRM Backfill Runbook

## Prerequisites
- Local CSV file: `Founders Club CRM - Founders Club CRM.csv` (not committed)
- Target workspace `clientId` known
- Database access configured

## Dry-Run (Required First)
\`\`\`bash
npx tsx scripts/import-founders-club-crm.ts \
  --clientId=<uuid> \
  --dry-run
\`\`\`

Expected output:
- Matched: N existing leads
- Would create: N new leads
- Would update: N leads
- Skipped (non-positive): N rows
- Errors: 0

## Apply (Non-Production First)
\`\`\`bash
# Set staging DATABASE_URL
export DATABASE_URL="postgresql://..."

npx tsx scripts/import-founders-club-crm.ts \
  --clientId=<uuid> \
  --apply
\`\`\`

## Apply (Production)
\`\`\`bash
npx tsx scripts/import-founders-club-crm.ts \
  --clientId=<uuid> \
  --apply
\`\`\`

## Verification
1. Open Prisma Studio: `npm run db:studio`
2. Navigate to LeadCrmRow table
3. Confirm:
   - Row count matches expected
   - interestRegisteredAt populated
   - leadCategoryOverride populated
   - pipelineStatus populated
4. Navigate to Lead table
5. Confirm:
   - jobTitle populated where CSV had values
```

### 3) QA checklist

**File:** `docs/planning/phase-90/artifacts/qa-checklist.md`

```markdown
# Phase 90 QA Checklist

## Schema (90a)
- [ ] `Lead.jobTitle` field exists
- [ ] `LeadCrmRow.leadType` field exists
- [ ] `LeadCrmRow.applicationStatus` field exists
- [ ] `LeadCrmRow.leadCategoryOverride` field exists
- [ ] `npm run db:push` succeeded

## Backfill (90b)
- [ ] Dry-run completes without errors
- [ ] Apply is idempotent (running twice = no additional changes)
- [ ] No PII in logs

## Computed Columns (90c)
- [ ] CRM table shows non-null stepResponded
- [ ] CRM table shows non-null followUp1-5 (for leads with pending tasks)
- [ ] CRM table shows correct responseStepComplete
- [ ] CRM table shows correct AI vs Human (post-interest)

## Inline Editing (90d)
- [ ] Rolling rate columns removed from UI
- [ ] Click-to-edit works for editable cells
- [ ] Lead Category edit shows "update automation" toggle
- [ ] Lead Status edit shows "update automation" toggle
- [ ] Assignment dropdown loads setters
- [ ] Save shows inline spinner
- [ ] Error shows inline (not alert)

## Response Attribution (90e)
- [ ] New CRM rows have responseMode = null
- [ ] Query-time computation returns correct AI/Human

## Quality Gates
- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] `npm run test` passes (with new crm-sheet.test.ts)
```

### 4) Run quality gates

```bash
npm run lint
npm run build
npm run db:push  # If schema changed
npm run test
```

## Validation (RED TEAM)
- [ ] Test file registered in `scripts/test-orchestrator.ts`
- [ ] All test cases pass
- [ ] Importer dry-run succeeds
- [ ] QA checklist items verified
- [ ] All quality gates pass

## Output
- Added `lib/__tests__/crm-sheet.test.ts` covering CRM mapping + response-mode helpers
- Registered test file in `scripts/test-orchestrator.ts`
- QA checklist + updated importer runbook in `docs/planning/phase-90/artifacts/`
- `npm run test` executed successfully

## Coordination Notes
**No direct conflicts** in files touched for this subphase.

## Validation Notes
- `npm run test` passed.
- `npm run lint` completed with warnings (no errors).
- `npm run build` completed successfully.

## Handoff
Phase 90 implementation is considered complete when success criteria are met and quality gates pass.
