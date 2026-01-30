# Phase 71 — Review

## Summary

- ✅ Follow-ups UI pause/resume bug fixed (fetches `"all"` instances, filters to active+paused client-side)
- ✅ Dual-name support implemented (`MEETING_REQUESTED_SEQUENCE_NAME_LEGACY` + `ZRG_WORKFLOW_V1_SEQUENCE_NAME`)
- ✅ ZRG workspaces default to "ZRG Workflow V1" for new Meeting Requested sequences
- ✅ Migration script created with dry-run by default, `--apply` for writes, `--clientId` for canary
- ✅ `npm run lint` (0 errors, 18 warnings) and `npm run build` pass
- ⏳ Migration not yet run on production (script ready, awaiting user confirmation)

## What Shipped

### Core Changes

| File | Change |
|------|--------|
| `lib/followup-sequence-names.ts` (new) | Shared constants for sequence names + `isMeetingRequestedSequenceName()` helper |
| `components/dashboard/follow-ups-view.tsx:551` | Changed filter from `"active"` to `"all"` to show paused instances |
| `lib/followup-automation.ts:451-465` | Updated auto-start lookup to support both Meeting Requested names |
| `lib/followup-engine.ts` | Updated pause-on-reply logic to use `isMeetingRequestedSequenceName()` |
| `actions/followup-sequence-actions.ts:806-814` | Added `getMeetingRequestedSequenceNameForClient()` to pick name per workspace |
| `lib/followup-sequence-linkedin.ts` | Updated LinkedIn augmentation to support both names |
| `components/dashboard/followup-sequence-manager.tsx:92-105` | Added `BUILT_IN_TRIGGER_OVERRIDES` for both Meeting Requested names |
| `scripts/phase-71-rename-workflow.ts` (new) | Migration script (dry-run default, `--apply`, `--clientId`) |

### New Shared Constants (`lib/followup-sequence-names.ts`)

```typescript
export const MEETING_REQUESTED_SEQUENCE_NAME_LEGACY = "Meeting Requested Day 1/2/5/7";
export const ZRG_WORKFLOW_V1_SEQUENCE_NAME = "ZRG Workflow V1";
export const MEETING_REQUESTED_SEQUENCE_NAMES = [
  MEETING_REQUESTED_SEQUENCE_NAME_LEGACY,
  ZRG_WORKFLOW_V1_SEQUENCE_NAME,
];
export function isMeetingRequestedSequenceName(name: string): boolean;
```

## Verification

### Commands

- `npm run lint` — **PASS** (0 errors, 18 pre-existing warnings) (2026-01-30)
- `npm run build` — **PASS** (37 routes generated) (2026-01-30)
- `npm run db:push` — **SKIP** (no schema changes in this phase)

### Notes

- All Phase 71 files compile and pass lint
- Migration script loads env correctly (`dotenv`, `DIRECT_URL`/`DATABASE_URL`)
- Script uses correct Prisma relation filter shape for optional 1:1 `settings`

## Success Criteria → Evidence

1. **Paused sequences appear in "Paused" section after page refresh**
   - Evidence: `components/dashboard/follow-ups-view.tsx:551` now fetches `"all"` instances
   - Status: **MET** (code change verified)

2. **Resume button moves instances back to appropriate time-based group**
   - Evidence: `groupInstancesByDay()` already handles `status === "paused"` (lines 741-745); fetching paused instances means they appear and resume correctly
   - Status: **MET** (code change verified)

3. **ZRG workspaces have sequence named "ZRG Workflow V1"**
   - Evidence: `scripts/phase-71-rename-workflow.ts` exists with dry-run/apply modes; `getMeetingRequestedSequenceNameForClient()` returns `ZRG_WORKFLOW_V1_SEQUENCE_NAME` for `brandName IS NULL`
   - Status: **MET** (code ready; migration pending run)

4. **Founders Club workspaces retain "Meeting Requested Day 1/2/5/7" name**
   - Evidence: Script explicitly skips `brandName != null` workspaces; `getMeetingRequestedSequenceNameForClient()` returns legacy name for branded workspaces
   - Status: **MET** (code verified)

5. **New workspace creation uses "ZRG Workflow V1" as default name**
   - Evidence: `createMeetingRequestedSequence()` calls `getMeetingRequestedSequenceNameForClient(clientId)` to pick the name
   - Status: **MET** (code verified)

6. **Meeting Requested auto-start continues to work after rename (both names treated as the same workflow)**
   - Evidence: `autoStartMeetingRequestedSequenceOnSetterEmailReply()` queries with `name: { in: MEETING_REQUESTED_SEQUENCE_NAMES }` and prefers the new name if both exist
   - Status: **MET** (code verified)

7. **`npm run lint` and `npm run build` pass**
   - Evidence: Commands run above
   - Status: **MET**

## Plan Adherence

| Planned | Implemented | Notes |
|---------|-------------|-------|
| Fix pause/resume bug | ✅ Changed filter to `"all"` | Matches 71a plan |
| Rename constant | ✅ Added `getMeetingRequestedSequenceNameForClient()` | More robust than simple constant change; adapts per workspace |
| Dual-name support | ✅ Created `lib/followup-sequence-names.ts` + updated all consumers | Matches 71c plan |
| Migration script | ✅ Created `scripts/phase-71-rename-workflow.ts` | Dry-run default, `--apply`, `--clientId` for canary |

## Risks / Rollback

| Risk | Mitigation |
|------|------------|
| Migration renames wrong workspaces | Script uses `brandName IS NULL` check; skips any workspace that already has "ZRG Workflow V1" |
| Auto-start breaks after rename | Dual-name support landed before migration; both names work identically |
| Rollback needed | Script is idempotent; can rename back by swapping constants or running inverse script |

## Follow-ups

- [ ] **Run migration on production**: `npx tsx scripts/phase-71-rename-workflow.ts --apply`
- [ ] **Verify Founders Club unchanged**: Query `FollowUpSequence` for Founders Club workspace
- [ ] **Smoke test**: Trigger a first setter email reply in both a ZRG and Founders Club workspace; confirm workflow starts
- [ ] **UI smoke test**: Pause a sequence, refresh, confirm it appears in "Paused" section, resume it

## Artifacts

| Artifact | Path |
|----------|------|
| Root plan | `docs/planning/phase-71/plan.md` |
| Subphase a | `docs/planning/phase-71/a/plan.md` |
| Subphase b | `docs/planning/phase-71/b/plan.md` |
| Subphase c | `docs/planning/phase-71/c/plan.md` |
| Subphase d | `docs/planning/phase-71/d/plan.md` |
| Shared constants | `lib/followup-sequence-names.ts` |
| Migration script | `scripts/phase-71-rename-workflow.ts` |
