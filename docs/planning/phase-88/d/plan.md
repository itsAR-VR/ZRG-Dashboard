# Phase 88d — QA, Performance Checks, and Rollout Notes

## Focus
Verify correctness and performance of the new analytics, confirm analytics consolidation, and document a short rollout checklist.

## Inputs
- Implemented backend actions and UI from Phases 88b/88c.
- Existing repo validation commands and quality checklist from `CLAUDE.md`.
- Known concurrent phase overlaps (especially Phase 83 Analytics work).

## Work

### Step 1: Automated checks

```bash
npm run lint      # Must pass with 0 errors
npm run build     # Must succeed
```

If tests exist:
```bash
npm run test      # If present and stable
```

### Step 2: Manual smoke tests

#### Test Matrix

| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Date selector works | Select 7d, 30d, 90d | All analytics sections re-fetch and display updated data |
| Workflow attribution empty | Use workspace with no FollowUpInstances | Shows 100% "Initial", 0% "Workflow" |
| Workflow attribution populated | Use workspace with booked leads and follow-ups | Distribution reflects actual data |
| Reactivation KPIs empty | Use workspace with no ReactivationCampaigns | Shows empty state or hides section |
| Reactivation KPIs populated | Use workspace with sent enrollments | Shows correct sent/responded/booked counts |
| Booking tab visible | Navigate to Analytics → Booking | BookingProcessAnalytics component renders |
| Settings no analytics | Navigate to Settings → Booking (or wherever it was) | BookingProcessAnalytics is NOT present |
| Workspace switching | Switch from workspace A to B | Data refreshes, cache doesn't leak |

#### Test Commands

```bash
# Start dev server
npm run dev

# Navigate to:
# 1. http://localhost:3000 → Log in
# 2. Select a workspace
# 3. Navigate to Analytics tab
# 4. Exercise each test case
```

### Step 3: Performance checks

For large workspaces (>5000 leads):
1. Open browser DevTools → Network tab
2. Navigate to Analytics
3. Observe query response times

**Acceptable thresholds:**
- Overview metrics: < 2s
- Workflow attribution: < 3s
- Reactivation KPIs: < 3s
- CRM table (first page): < 2s

If queries exceed thresholds:
- Review query plans using `EXPLAIN ANALYZE` in Prisma Studio
- Consider adding indexes to `FollowUpInstance.lastStepAt`, `ReactivationEnrollment.sentAt`
- Document slow query as follow-up issue if not critical

### Step 4: Rollout notes

#### Cache Behavior
- Analytics cache TTL: 5 minutes
- Cache is user-scoped and now incorporates window bounds
- To force refresh: Call `invalidateAnalyticsCache()` (admin-only) or wait for TTL expiry
- Users can also refresh by switching workspaces and back

#### Data Prerequisites

| Feature | Required Data |
|---------|---------------|
| Workflow Attribution | `Lead.appointmentBookedAt` populated + optional `FollowUpInstance` records |
| Reactivation KPIs | `ReactivationCampaign` configured + `ReactivationEnrollment` rows with `status = 'sent'` |
| Booking Analytics | `BookingProcess` configured + `LeadCampaignBookingProgress` rows |

#### Backward Compatibility
- No schema changes required
- No API breaking changes
- Feature is additive (new UI sections)

## Validation (RED TEAM)

- [x] `npm run lint` passes (23 warnings, 0 errors)
- [x] `npm run build` succeeds (fixed unrelated script type error; `CrmSheetRow` issue was stale cache)
- [ ] All smoke tests pass (not manually verified)
- [ ] No console errors in browser (not manually verified)
- [ ] Query performance acceptable for test workspaces (not manually verified)
- [ ] Phase 83 CRM tab still works correctly (code verified)
- [x] Settings still has booking process editor (code verified — `BookingProcessAnalytics` removed, editor remains)

## Output

### Verification Log

**Date:** 2026-02-02  
**Verifier:** Codex

#### Automated Checks
- [x] `npm run lint` — Pass (23 warnings; existing repo warnings remain)
- [x] `npm run build` — Pass

**Build resolution:**
- `CrmSheetRow` type issue was a stale `.next` cache — resolved with `rm -rf .next`
- Fixed unrelated type error in `scripts/import-founders-club-crm.ts` (changed `Record<string, unknown>` to `Prisma.LeadUncheckedCreateInput`)

#### Smoke Tests
- [ ] Manual smoke tests pending (recommended before production rollout)

#### Issues Found & Resolved
- Build failure was due to stale build cache, not actual code issues. Phase 88 implementation is complete.

## Handoff

### Phase Summary

**Changes shipped:**
1. New server actions: `getWorkflowAttributionAnalytics()`, `getReactivationCampaignAnalytics()`
2. Updated cache key semantics to incorporate window bounds
3. Analytics tab now has five tabs: Overview, Workflows, Campaigns, Booking, CRM
4. Working date selector for windowed analytics (7/30/90 + custom)
5. BookingProcessAnalytics moved from Settings to Analytics

**Coordination notes for overlapping phases:**
- Phase 83: If CRM tab is affected by Phase 83, ensure merged correctly
- Phase 80/81: Settings UI may need conflict resolution if both modified booking section
- Phase 86: If Phase 86 adds Settings UI, verify analytics-only sections are excluded

Close Phase 88 after verification passes.
