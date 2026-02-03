# Phase 98 — Stop Follow-Up Sequences When Meeting Is Booked (GHL + Calendly)

## Purpose
Ensure that when a lead books a meeting via a calendar link (GoHighLevel or Calendly), all non-post-booking follow-up sequences stop automatically (mark `FollowUpInstance` as `completed`) within ~1 minute.

## Context
Bug report (Jam): `https://jam.dev/c/aaf7e47d-a3d9-4053-b578-a27e8cafc26c`

Observed symptom:
- A lead books a meeting via a calendar link, but existing outreach workflows/sequences keep running instead of stopping automatically.

Repo reality (discovered during investigation):
- The system already has booking side-effects helpers:
  - `pauseFollowUpsOnBooking(leadId, { mode: "complete" })` in `lib/followup-engine.ts`
  - Booking/webhook/reconcile paths call this in some places (`app/api/webhooks/calendly/[clientId]/route.ts`, `lib/booking.ts`, `lib/ghl-appointment-reconcile.ts` for "forLead" reconciliation).
- However, there are gaps that can leave active sequences running after booking:
  1) **Reconciliation eligibility is too "cold"**: `lib/appointment-reconcile-runner.ts` prioritizes `lastInboundAt != null` + stale-day watermark (default 7 days). This misses/defers "hot" leads who are actively in sequences and just booked.
  2) **Reconcile-by-id / by-uri paths don't apply booking side-effects**: they update appointment/lead state but may not complete sequences / start post-booking sequences on transition.
  3) **Follow-up processing doesn't hard-stop on `Lead.status = "meeting-booked"`**: `processFollowUpsDue()` only filters on `FollowUpInstance.status = "active"` and lead enablement; it does not re-check booking status. If a lead becomes booked through a path that doesn't complete instances, sends can continue.
  4) **Manual "Meeting Booked" actions don't stop instances**: some UI/server actions set `Lead.status = "meeting-booked"` without completing follow-up instances.

Decisions locked (from this conversation):
- Providers in scope: **GHL and Calendly**.
- Stop mode: **Complete** all non-`meeting_selected` sequences (do not pause).
- SLA target: **~1 minute** from booking to "sequences stopped".
- No schema changes planned.

## Concurrent Phases
Working tree is currently dirty; some files that Phase 98 may need to touch are already modified by other phases. Treat these as integration constraints during implementation.

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 97 | Uncommitted working tree | `scripts/test-orchestrator.ts` (modified), `app/api/cron/followups/route.ts` (modified) | When adding Phase 98 tests, merge registrations with Phase 97 changes; do not overwrite. Phase 97 added advisory locking to followups cron—Phase 98 backstop must run inside the lock. |
| Phase 94 | Shipped but local tree may differ | Domain: follow-ups + cron hardening | If touching shared cron patterns, follow Phase 94 conventions (auth before body, bounded work, logging). |
| Phase 93 | Shipped | Domain: follow-up automation routing | Ensure booking-stop behavior does not break persona-routed post-booking sequences (`triggerOn="meeting_selected"`). |

---

## Repo Reality Check (RED TEAM)

### What Exists Today

| Component | File Path | Verified |
|-----------|-----------|----------|
| `pauseFollowUpsOnBooking()` | `lib/followup-engine.ts:1736` | ✓ Exists, mode defaults to "complete" |
| `autoStartPostBookingSequenceIfEligible()` | `lib/followup-automation.ts` | ✓ Exists |
| Reconcile runner (lead eligibility) | `lib/appointment-reconcile-runner.ts:153` (`getEligibleLeads`) | ✓ Requires `lastInboundAt != null` |
| GHL reconcile forLead | `lib/ghl-appointment-reconcile.ts:128` (`reconcileGHLAppointmentForLead`) | ✓ Applies side effects on `isNewBooking` |
| GHL reconcile byId | `lib/ghl-appointment-reconcile.ts:298` (`reconcileGHLAppointmentById`) | ✓ Exists, **but NO side effects** |
| Calendly reconcile forLead | `lib/calendly-appointment-reconcile.ts:143` (`reconcileCalendlyBookingForLead`) | ✓ Applies side effects on `isNewBooking` |
| Calendly reconcile byUri | `lib/calendly-appointment-reconcile.ts:394` (`reconcileCalendlyBookingByUri`) | ✓ Exists, **but NO side effects** |
| Calendly webhook | `app/api/webhooks/calendly/[clientId]/route.ts` | ✓ Exists |
| CRM `bookMeeting` action | `actions/crm-actions.ts:589` | ✓ Exists, **but NO side effects** |
| Followup `updateLeadFollowUpStatus` | `actions/followup-actions.ts:467` | ✓ Exists, **but NO side effects when outcome="meeting-booked"** |
| Followups cron | `app/api/cron/followups/route.ts` | ✓ Modified by Phase 97 (advisory locking) |
| GHL contact resolver | `lib/ghl-contacts.ts:40` (`resolveGhlContactIdForLead`) | ✓ Exists |
| Test orchestrator | `scripts/test-orchestrator.ts` | ✓ Modified by Phase 97 |

### Provider Requirements

| Provider | Eligibility Requirement | Current | Gap |
|----------|-------------------------|---------|-----|
| GHL | `ghlContactId` present | ✓ | Can use `resolveGhlContactIdForLead()` to attempt linking if missing |
| Calendly | `email` present | ✓ | Already correct |

---

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-Risk Failure Modes

| Failure Mode | Impact | Mitigation |
|--------------|--------|------------|
| **Reconcile-byId / byUri paths don't complete sequences** | Lead booked via reconcile cron continues receiving follow-ups | Add side effects to `reconcileGHLAppointmentById()` and `reconcileCalendlyBookingByUri()` |
| **Manual "Meeting Booked" actions don't stop sequences** | Setter marks lead booked → sequences continue | Add `pauseFollowUpsOnBooking()` call to `bookMeeting()` and `updateLeadFollowUpStatus()` |
| **Hot leads not prioritized in reconciliation** | Actively sequenced leads wait 7 days before reconcile catches booking | Add hot-lead tier (1-minute cutoff) for leads with active non-post-booking instances |
| **Race: cron sends message before reconcile completes booking** | Message sent after booking but before instance completion | Add backstop in followups cron to complete instances for `meeting-booked` leads |

### Missing or Ambiguous Requirements

| Gap | Resolution |
|-----|------------|
| `reconcileGHLAppointmentById` doesn't apply side effects | Add transition detection + side effects (lines 372-384 just upserts, no `pauseFollowUpsOnBooking`) |
| `reconcileCalendlyBookingByUri` doesn't apply side effects | Add transition detection + side effects (lines 448-478 just upserts, no `pauseFollowUpsOnBooking`) |
| `actions/crm-actions.ts:bookMeeting()` only sets status | Add `pauseFollowUpsOnBooking(leadId, { mode: "complete" })` after status update |
| `actions/followup-actions.ts:updateLeadFollowUpStatus()` outcome="meeting-booked" only sets status | Add `pauseFollowUpsOnBooking(leadId, { mode: "complete" })` when outcome is "meeting-booked" |
| Hot-lead eligibility not defined in runner | Add `FollowUpInstance.status="active" && sequence.triggerOn != "meeting_selected"` check |

### Repo Mismatches (Fix the Plan)

| Issue | Correction |
|-------|------------|
| Plan 98b says GHL reconcile "byId" may need side effects | Confirmed: `reconcileGHLAppointmentById()` does NOT call `pauseFollowUpsOnBooking()` (line 372-384) |
| Plan 98c says Calendly reconcile "byUri" may need side effects | Confirmed: `reconcileCalendlyBookingByUri()` does NOT call `pauseFollowUpsOnBooking()` (line 448-478) |
| Plan mentions `actions/crm-actions.ts:bookMeeting` | Line 589-605—confirmed NO side effects |
| Plan mentions `actions/followup-actions.ts:updateLeadFollowUpStatus` | Line 467-506—confirmed NO side effects |
| `app/api/cron/followups/route.ts` was modified by Phase 97 | Phase 97 added advisory locking (`tryAcquireLock`/`releaseLock`). Backstop must be added inside `runFollowupsCron()`. |

### Performance / Timeouts

| Risk | Mitigation |
|------|------------|
| Hot-lead query could be expensive if many active instances | Add index-friendly query: join on `FollowUpInstance.leadId` with existing indexes |
| Backstop `updateMany` could touch many instances | Scope to `WHERE lead.status = "meeting-booked"` using subquery; run once per cron |
| Reconcile API calls for hot leads | Respect existing `leadsPerWorkspace` limit; hot leads fill from top of capacity |

### Security / Permissions

| Risk | Mitigation |
|------|------------|
| Cron endpoints already validate `CRON_SECRET` | No change needed—existing pattern in `app/api/cron/followups/route.ts:205-216` |
| Server actions use `requireLeadAccessById()` | Existing pattern—no change needed |

### Testing / Validation

| Gap | Mitigation |
|-----|------------|
| No test for hot-lead eligibility | Add unit test in Phase 98b |
| No test for backstop behavior | Add unit test in Phase 98d |
| No test for byId/byUri side effects | Add integration-style test or verify in manual QA |

### Multi-Agent Coordination

| Check | Status |
|-------|--------|
| Last 10 phases scanned for overlap | ✓ Phase 97 modified `scripts/test-orchestrator.ts` and `app/api/cron/followups/route.ts` |
| Uncommitted changes in target files | ⚠️ `app/api/cron/followups/route.ts` modified (advisory locking), `scripts/test-orchestrator.ts` modified |
| Schema changes | ✗ None required |
| Coordination strategy | Merge Phase 98 test registrations with Phase 97's list; add backstop inside `runFollowupsCron()` after advisory lock is acquired |

---

## Objectives
* [x] Make appointment reconciliation prioritize "hot" leads (active sequences) and re-check booking state on a 1-minute cadence.
* [x] Ensure booking transitions (booked/canceled) apply the correct follow-up side effects across all reconcile code paths.
* [x] Add a cron backstop so any `meeting-booked` lead cannot have active non-post-booking instances.
* [x] Ensure manual "Meeting Booked" actions also complete instances immediately.
* [x] Add unit tests for the new reconciliation eligibility + backstop behavior and register them in the test orchestrator.

## Constraints
- **Stop semantics:** On booking, complete all follow-up instances where `sequence.triggerOn != "meeting_selected"`.
- **Post-booking sequences:** Allow `triggerOn="meeting_selected"` sequences to run/auto-start as designed.
- **SLA:** booking → sequences completed within ~1 minute (via hot-lead reconcile + cron backstop).
- **No schema changes** in this phase (if requirements change, run `npm run db:push` per repo policy).
- **Provider API usage:** avoid retry storms; keep reconciliation bounded by limits and watermark.
- **Security:** do not log secrets/PII; cron endpoints must validate `CRON_SECRET` before doing work.

## Success Criteria
- [ ] Booking via **GHL** or **Calendly** results in:
  - [ ] `Lead.status = "meeting-booked"` (from webhook/reconcile), and
  - [ ] all non-post-booking follow-up instances become `status="completed"` within ~1 minute. *(Manual QA pending.)*
- [ ] No further outbound follow-up sends occur for booked leads from non-post-booking sequences. *(Manual QA pending.)*
- [ ] Post-booking sequence (triggerOn `meeting_selected`) still auto-starts when provider evidence exists. *(Manual QA pending.)*
- [x] Tests, lint, and build pass: `npm run test`, `npm run lint`, `npm run build`. *(Lint/build warnings noted in Phase Summary.)*

## Subphase Index
* a — Baseline + Stop Semantics Audit
* b — Hot-Lead Reconciliation (Runner + GHL Contact Resolution)
* c — Booking Transition Side Effects (All Paths)
* d — Followups Cron Backstop + Tests
* e — Verification + Rollout Notes

---

## Assumptions (Agent)

1. **Assumption:** `resolveGhlContactIdForLead()` is safe to call during reconciliation (search-only, no create).
   - *Confidence:* ~95%
   - *Mitigation:* If GHL rate limits become an issue, add a feature flag to skip resolution.

2. **Assumption:** Existing `leadsPerWorkspace` limit (default 50) provides sufficient capacity for hot leads.
   - *Confidence:* ~90%
   - *Mitigation:* Add `RECONCILE_HOT_LIMIT` env var if hot leads need separate cap.

3. **Assumption:** The backstop `updateMany` is idempotent and safe to run every cron tick.
   - *Confidence:* ~99%
   - *Mitigation:* Query shape is narrow (status + triggerOn filter); no side effects beyond status change.

4. **Assumption:** Phase 97's advisory locking in followups cron should wrap the backstop call.
   - *Confidence:* ~95%
   - *Mitigation:* If backstop needs to run independently, move it before lock acquisition.

---

## Open Questions (Need Human Input)

None—all requirements are sufficiently specified from the Jam report and conversation context.

---

## Phase Summary

### Status
✅ Complete (manual QA pending)

### What changed
- Added hot-lead eligibility + warm fallback in appointment reconciliation to meet 1-minute SLA.
- Applied booking side effects to GHL by-id and Calendly by-URI reconciliation paths.
- Added booking side effects to manual "Meeting Booked" actions and a followups cron backstop.
- Added unit tests for eligibility + backstop and registered them in the test orchestrator.

### Artifacts
- `lib/appointment-reconcile-runner.ts`
- `lib/ghl-appointment-reconcile.ts`
- `lib/calendly-appointment-reconcile.ts`
- `actions/crm-actions.ts`
- `actions/followup-actions.ts`
- `lib/followup-engine.ts`
- `app/api/cron/followups/route.ts`
- `scripts/test-orchestrator.ts`
- `lib/__tests__/appointment-reconcile-eligibility.test.ts`
- `lib/__tests__/followups-backstop.test.ts`

### Validation
- `npm run test` ✅
- `npm run lint` ✅ (warnings only; existing hook/img warnings)
- `npm run build` ✅ (warnings: baseline-browser-mapping outdated, CSS optimizer token warnings, Next.js middleware deprecation)

### Follow-ups
- Run manual QA checklist in a production-like environment to confirm the SLA and post-booking behavior.

### Review
- Review date: 2026-02-03
- See `docs/planning/phase-98/review.md` for full evidence mapping and verification results.
