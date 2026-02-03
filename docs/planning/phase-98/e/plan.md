# Phase 98e — Verification + Rollout Notes

## Focus
Verify the fix end-to-end, document configuration knobs, and define a safe rollout/monitoring approach.

## Inputs
- Phase 98b–98d code changes
- Cron schedules: `vercel.json` (appointment-reconcile + followups run every minute)

## Work

### Step 1: Run validation gates

```bash
npm run test    # All tests pass
npm run lint    # No errors (warnings OK)
npm run build   # TypeScript compiles successfully
```

**Results (local):**
- `npm run test` ✅ (passed)
- `npm run lint` ✅ (warnings only; no errors)
- `npm run build` ✅ (passed; warnings noted below)

### Step 2: Verify file changes

Confirm the following files were modified:

| File | Change |
|------|--------|
| `lib/appointment-reconcile-runner.ts` | Hot-lead reconciliation + provider eligibility (GHL email/appointment id) |
| `lib/ghl-appointment-reconcile.ts` | Side effects in `reconcileGHLAppointmentById()` |
| `lib/calendly-appointment-reconcile.ts` | Side effects in `reconcileCalendlyBookingByUri()` |
| `actions/crm-actions.ts` | Side effects in `bookMeeting()` |
| `actions/followup-actions.ts` | Side effects in `updateLeadFollowUpStatus()` |
| `lib/followup-engine.ts` | New `completeFollowUpsForMeetingBookedLeads()` |
| `app/api/cron/followups/route.ts` | Backstop call added |
| `scripts/test-orchestrator.ts` | New test registrations |
| `lib/__tests__/followups-backstop.test.ts` | New test file |
| `lib/__tests__/appointment-reconcile-eligibility.test.ts` | New test file |

### Step 3: Manual verification checklist (production-like)

1. **Setup:**
   - Pick a lead with an active non-post-booking follow-up instance (`status="active"`, `sequence.triggerOn != "meeting_selected"`)
   - Note the lead's current `appointmentLastCheckedAt` and `status`

2. **Test GHL booking:**
   - Book via GHL calendar link
   - Wait ~1 minute
   - Verify:
     - [ ] `Lead.status = "meeting-booked"`
     - [ ] All non-post-booking instances are `status="completed"`
     - [ ] No additional follow-up sends occur from those sequences

3. **Test Calendly booking:**
   - Pick another lead with active non-post-booking instance
   - Book via Calendly booking link
   - Wait ~1 minute
   - Verify:
     - [ ] `Lead.status = "meeting-booked"`
     - [ ] All non-post-booking instances are `status="completed"`
     - [ ] No additional follow-up sends occur from those sequences

4. **Test manual booking:**
   - Pick another lead with active instance
   - Mark as "Meeting Booked" via CRM UI or Follow-ups UI
   - Verify immediately (no wait):
     - [ ] All non-post-booking instances are `status="completed"`

5. **Verify post-booking sequences:**
   - Confirm `meeting_selected` sequences may still auto-start when provider evidence exists
   - These should NOT be completed by the backstop

### Step 4: Config guidance

| Env Var | Default | Description |
|---------|---------|-------------|
| `RECONCILE_HOT_MINUTES` | `1` | How many minutes before a hot lead is eligible for re-reconciliation |
| `RECONCILE_LEADS_PER_WORKSPACE` | `50` | Max leads per workspace per reconciliation run |
| `RECONCILE_WORKSPACE_LIMIT` | `10` | Max workspaces per reconciliation run |
| `RECONCILE_STALE_DAYS` | `7` | Days before a lead is considered "stale" for re-reconciliation |

**Tuning recommendations:**
- If a workspace often has >50 "hot" leads, raise `RECONCILE_LEADS_PER_WORKSPACE` to ensure they're checked every minute.
- If provider API rate limits become an issue, increase `RECONCILE_HOT_MINUTES` to 2–5.

### Step 5: Monitoring/rollback notes

**Monitor:**
- Appointment-reconcile cron logs: look for errors, circuit-breaker signals, and hot-lead counts.
- Followups cron logs: look for backstop output (`[Backstop] Completed N orphaned instances`).
- `FollowUpInstance` table: monitor for instances that remain `active` for leads with `status="meeting-booked"`.

**Alerts to consider:**
- Alert if backstop completes >10 instances per hour (indicates side-effect paths are being bypassed).
- Alert if reconciliation error rate exceeds 50% (circuit breaker should trip).

**Rollback:**
- If issues arise, revert the changes to:
  - `lib/appointment-reconcile-runner.ts` (remove hot-lead logic)
  - `app/api/cron/followups/route.ts` (remove backstop call)
- The backstop is idempotent and safe to remove; existing side-effect paths still work.

## Output
- Validation gates complete: `npm run test` passed; `npm run lint` completed with warnings only (existing hook/img warnings); `npm run build` succeeded with warnings (baseline-browser-mapping outdated, CSS optimizer token warnings, Next.js middleware deprecation notice).
- Manual QA checklist remains pending in a production-like environment.

## Handoff
Update success criteria + Phase Summary in `docs/planning/phase-98/plan.md`. Manual QA is still required to fully satisfy the booking stop SLA.

---

## Phase Summary

### Status
✅ Complete (manual QA pending)

### What will ship
- Hot-lead reconciliation (1-minute SLA for actively sequenced leads)
- GHL email-based contact linking during reconciliation
- Booking side effects in all reconcile-by-id/uri paths
- Booking side effects in manual CRM/Follow-up actions
- Cron backstop to catch edge cases

### Verification
- [x] `npm run test` passes
- [x] `npm run lint` passes (warnings only)
- [x] `npm run build` passes
- [ ] Manual QA: GHL booking → sequences completed
- [ ] Manual QA: Calendly booking → sequences completed
- [ ] Manual QA: Manual booking → sequences completed
- [ ] Manual QA: Post-booking sequences still work

### Follow-ups
- Monitor backstop output in production to identify any paths that bypass side effects.
- If hot-lead volume is high, consider adding a dedicated cron for hot reconciliation.
