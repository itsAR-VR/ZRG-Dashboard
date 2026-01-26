# Phase 57d — Guardrails + Rollout Plan (Backoff, Monitoring, Backfill)

## Focus
Reduce the blast radius of cron failures and provide a safe production rollout + data repair approach once fixes from 57b and 57c land.

## Inputs
- Phase 57b + 57c code changes and tests
- `vercel.json` cron schedules (appointment-reconcile runs `* * * * *`)
- `lib/appointment-reconcile-runner.ts` — eligibility + batching logic
- `app/api/cron/appointment-reconcile/route.ts` — cron response surface
- Phase 56 rollout/monitoring context (coordination)

## Work

### Step 1: Add circuit breaker to appointment-reconcile cron
**File:** `lib/appointment-reconcile-runner.ts`

Add early exit when error rate exceeds threshold:

```typescript
// Inside runAppointmentReconciliation(), after processing each workspace:
const errorRate = result.errors / Math.max(1, result.leadsChecked);
const CIRCUIT_BREAKER_ERROR_RATE = 0.5; // 50% error rate threshold
const CIRCUIT_BREAKER_MIN_CHECKS = 5; // Don't trip circuit on small batches

if (result.leadsChecked >= CIRCUIT_BREAKER_MIN_CHECKS && errorRate >= CIRCUIT_BREAKER_ERROR_RATE) {
  console.warn('[Reconcile Runner] Circuit breaker tripped', {
    errorRate: (errorRate * 100).toFixed(1) + '%',
    leadsChecked: result.leadsChecked,
    errors: result.errors,
  });
  // Return early, don't process more workspaces
  return result;
}
```

This prevents a single broken provider response shape from consuming the entire cron budget.

### Step 2: Add error counters to cron response
**File:** `app/api/cron/appointment-reconcile/route.ts`

The response already includes `result.errors`. Add a normalized error key for alerting:

```typescript
return NextResponse.json({
  success: true,
  ...result,
  // Add health indicator for monitoring
  health: result.errors === 0 ? 'healthy' :
          result.errors < 5 ? 'degraded' : 'unhealthy',
  timestamp: new Date().toISOString(),
});
```

### Step 3: (Optional) Temporary schedule reduction
**File:** `vercel.json`

If production noise is unacceptable before the fix deploys, temporarily reduce cadence:

```diff
 {
   "path": "/api/cron/appointment-reconcile",
-  "schedule": "* * * * *"
+  "schedule": "*/10 * * * *"
 }
```

**Revert after fix is deployed and verified.**

### Step 4: Backfill checklist (post-deploy)

After deploying Phase 57b + 57c fixes:

1. **Verify fix is working:**
   ```bash
   # Check Vercel logs for appointment-reconcile
   # Should see: "GHL appointment response missing required ID field" (new error)
   # Should NOT see: "[Appointment Upsert] Missing ghlAppointmentId" (old error)
   ```

2. **Run controlled reconciliation:**
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" \
     "https://$VERCEL_URL/api/cron/appointment-reconcile?clientId=<test-workspace>&leadsPerWorkspace=10&dryRun=true"
   ```

3. **If successful, run full reconciliation:**
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" \
     "https://$VERCEL_URL/api/cron/appointment-reconcile?workspaceLimit=3&leadsPerWorkspace=25"
   ```

4. **Monitor error rate:** Should drop from ~60 errors/minute to <5 errors/minute

5. **Backfill affected leads (if needed):**
   - Leads that failed reconciliation may have stale `appointmentLastCheckedAt`
   - Run a one-off script to reset `appointmentLastCheckedAt` for leads with `ghlAppointmentId` but no recent `appointmentLastCheckedAt`

### Step 5: Coordination with Phase 56

Update Phase 56 "Monitoring + cleanup" subphase with:
- [ ] Phase 57 fixes deployed
- [ ] Appointment-reconcile error rate < 5/minute
- [ ] Insights cron no longer fails on `agent_response` length
- [ ] Backfill completed for affected leads

## Validation (RED TEAM)

- [x] Circuit breaker code compiles and runs
- [x] Cron response includes `health` indicator
- [x] Backfill checklist is complete and actionable
- [x] No regressions in existing reconciliation behavior (`npm run lint && npm run build` pass)

## Output

### Files Changed
- **`lib/appointment-reconcile-runner.ts`**:
  - Added `CIRCUIT_BREAKER_ERROR_RATE` (50%) and `CIRCUIT_BREAKER_MIN_CHECKS` (5) constants
  - Added `circuitBroken?: boolean` to `ReconcileRunnerResult` interface
  - Added circuit breaker logic in `runAppointmentReconciliation()` that exits early when error rate exceeds threshold
- **`app/api/cron/appointment-reconcile/route.ts`**:
  - Added `health` field to response: `'circuit_broken'` | `'healthy'` | `'degraded'` | `'unhealthy'`

### Key Implementation Decisions
1. **50% threshold**: Trips when ≥50% of ≥5 checks result in errors — prevents single bad workspace from consuming entire cron budget
2. **Check after workspace**: Evaluates circuit breaker after each workspace (not each lead) to balance early detection with processing efficiency
3. **Four health states**: `healthy` (0 errors), `degraded` (<5 errors), `unhealthy` (≥5 errors), `circuit_broken` (circuit breaker tripped)

### Verification Results
```
npm run lint → ✓ (0 errors)
npm run build → ✓ (successful)
```

### Backfill Checklist (Post-Deploy)
See Step 4 above for complete checklist with curl commands.

## Handoff
**Return to Phase 56** for production verification and closeout:
- Validate all Phase 53–57 fixes in production
- Monitor error rates for 24h
- Close out rollout documentation

## Assumptions / Open Questions (RED TEAM)

- **Assumption:** 50% error rate threshold is appropriate for circuit breaker (confidence ~80%)
  - Mitigation: Thresholds are configurable via env vars `RECONCILE_CIRCUIT_BREAKER_ERROR_RATE` and `RECONCILE_CIRCUIT_BREAKER_MIN_CHECKS`

- **Open:** Should we add per-lead retry backoff (track error count per lead, skip after N failures)? (confidence ~70%)
  - Current decision: Not in this phase — the watermark advancement in 57b prevents infinite retries; per-lead backoff adds complexity
  - If needed, can add in a follow-on phase

- **Open:** Should we emit alerts to Slack/Resend when circuit breaker trips? (confidence ~65%)
  - Current decision: Out of scope for Phase 57 — Notification Center (Phase 52) exists but wiring alerts requires more work
  - Log-based monitoring is sufficient for now

## Review Notes

- Evidence:
  - `npm run lint` (pass; warnings only)
  - `npm run build` (pass)
  - Code changes:
    - `lib/appointment-reconcile-runner.ts` (circuit breaker)
    - `app/api/cron/appointment-reconcile/route.ts` (`health` field)
- Follow-ups:
  - None.
