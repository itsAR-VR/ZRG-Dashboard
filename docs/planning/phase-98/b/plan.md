# Phase 98b — Hot-Lead Reconciliation (Runner + GHL Contact Resolution)

## Focus
Make reconciliation fast enough to catch bookings quickly (≤1 minute) and capable of reconciling GHL bookings even when `ghlContactId` is missing but email exists.

## Inputs
- Phase 98a output: hot-lead definition and enforcement points
- Current runner: `lib/appointment-reconcile-runner.ts`
- Current GHL reconcile: `lib/ghl-appointment-reconcile.ts`
- GHL contact linking helper: `lib/ghl-contacts.ts:40` (`resolveGhlContactIdForLead`)

## Work

### Step 1: Add hot-lead reconciliation path in runner

File: `lib/appointment-reconcile-runner.ts`

1. Add env var and helper for hot cutoff:
   ```ts
   const DEFAULT_HOT_MINUTES = 1;
   function getHotMinutes(): number {
     const parsed = Number.parseInt(process.env.RECONCILE_HOT_MINUTES || "", 10);
     return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HOT_MINUTES;
   }
   ```

2. Create `getHotLeads()` function (new) to select leads with active non-post-booking instances:
   - Query: `FollowUpInstance.status = "active" AND sequence.triggerOn != "meeting_selected"`
   - Filter: `lead.appointmentLastCheckedAt IS NULL OR < hotCutoff`
   - Select: `lead.id, ghlContactId, email, ghlAppointmentId, calendlyScheduledEventUri`
   - Limit: `hotLimit` (new option, default `leadsPerWorkspace / 2`)

3. Update `getEligibleLeads()` or rename to `getWarmLeads()`:
   - Remove `lastInboundAt != null` requirement for "hot" tier (keep for "warm" tier)
   - Keep existing stale-day logic for "warm" tier

4. Update `reconcileWorkspace()` to:
   - First, fetch and process hot leads up to `hotLimit`
   - Then, fill remaining capacity with warm/stale leads
   - Total cannot exceed `leadsPerWorkspace`

### Step 2: Expand GHL eligibility (contact linking)

File: `lib/appointment-reconcile-runner.ts` (in `reconcileWorkspace` or `reconcileSingleLead`)

1. Before calling `reconcileGHLAppointmentForLead()`, check if `lead.ghlContactId` is null but `lead.email` exists:
   ```ts
   if (provider === "GHL" && !lead.ghlContactId && lead.email) {
     const resolved = await resolveGhlContactIdForLead(lead.id);
     if (resolved.success && resolved.ghlContactId) {
       // Contact was linked; proceed with reconciliation
     }
   }
   ```

2. Import `resolveGhlContactIdForLead` from `@/lib/ghl-contacts`.

3. Update `getEligibleLeads()` GHL provider filter to allow leads with email even if `ghlContactId` is null:
   ```ts
   const providerWhere =
     provider === "GHL"
       ? { OR: [{ ghlContactId: { not: null } }, { email: { not: null } }] }
       : { email: { not: null } };
   ```

### Step 3: Ensure reconciliation remains bounded

- Respect existing `workspaceLimit` and `leadsPerWorkspace` limits.
- Hot leads take priority but don't exceed the workspace limit.
- Watermark (`appointmentLastCheckedAt`) is still updated to prevent retry storms.

### Step 4: Add unit tests for hot-lead eligibility

File: `lib/__tests__/appointment-reconcile-hot-eligibility.test.ts` (new)

Tests:
1. Validate hot-lead selection includes leads with active non-post-booking instances.
2. Validate hot cutoff uses minutes (not days).
3. Validate leads WITHOUT `lastInboundAt` are still eligible for hot tier if they have active instances.
4. Validate GHL provider allows email-based leads (for linking attempt).
5. Validate Calendly provider still requires email.
6. Validate capacity split: hot leads don't exceed `hotLimit`, warm leads fill remaining.

## Output
- Code updates in `lib/appointment-reconcile-runner.ts`:
  - New `getHotLeads()` function
  - Updated `reconcileWorkspace()` to prioritize hot leads
  - Expanded GHL eligibility to attempt contact linking
- A new unit test file `lib/__tests__/appointment-reconcile-eligibility.test.ts`

### Completed
- Implemented hot-lead prioritization in `lib/appointment-reconcile-runner.ts` using:
  - `RECONCILE_HOT_MINUTES` (default 1) and `getHotCutoff()` for 1‑minute SLA
  - `buildHotLeadWhere()` + `buildWarmLeadWhere()` to keep hot leads first, warm leads fill remaining capacity
  - Provider eligibility now allows GHL leads with `email` or `ghlAppointmentId` (not just `ghlContactId`)
- Added GHL contact resolution inside `lib/ghl-appointment-reconcile.ts` so missing `ghlContactId` triggers a search/link before skipping.
- Updated `reconcileSingleLead()` to allow by‑ID reconciliation without requiring `ghlContactId` upfront.
- Added tests: `lib/__tests__/appointment-reconcile-eligibility.test.ts`
- Registered the new test in `scripts/test-orchestrator.ts`.

## Coordination Notes
**Integrated from Phase 97:** `scripts/test-orchestrator.ts` was already modified; merged by adding the new test entry without overwriting existing list items.  
**Files affected:** `scripts/test-orchestrator.ts`

## Validation (RED TEAM)
- Run `npm run test` to verify existing reconciliation tests still pass.
- Verify new test file is syntactically correct (can be validated via `npx tsx --conditions=react-server lib/__tests__/appointment-reconcile-eligibility.test.ts`).

## Handoff
Proceed to Phase 98c:
- Add booking side effects to reconcile-by-id/uri paths.
- Add `pauseFollowUpsOnBooking(..., complete)` to manual meeting-booked actions.
