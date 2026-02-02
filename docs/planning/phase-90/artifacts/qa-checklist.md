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
