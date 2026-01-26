# Phase 56b — Phase 55 Cron Verification + Enablement

## Focus
Validate Phase 55’s EmailBison first-touch `availability_slot` injection in production using dry-run mode and a single-lead E2E verification, then confirm it can run safely on a 1-minute schedule.

## Inputs
- `docs/planning/phase-55/review.md`
- `docs/planning/phase-55/c/plan.md` (verification + rollout checklist)
- `app/api/cron/emailbison/availability-slot/route.ts`
- `lib/emailbison-first-touch-availability.ts`
- `vercel.json` cron schedule

## Work
1) **Dry run in production**
   - Call `/api/cron/emailbison/availability-slot?dryRun=true` with `Authorization: Bearer $CRON_SECRET`.
   - Confirm counters look plausible and `finishedWithinBudget=true`.

2) **Single-lead E2E verification**
   - Identify a lead with `emails_sent=0` and scheduled send within ~15 minutes.
   - Run cron with `dryRun=false` (or wait for schedule) and verify:
     - EmailBison lead has `availability_slot` set (and other vars are not clobbered).
     - DB `Lead.offeredSlots` contains the same offered slots.
     - `WorkspaceOfferedSlot` counts incremented for those slots.

3) **Downstream acceptance → auto-book**
   - Confirm inbound acceptance of an offered slot still triggers deterministic auto-booking.

4) **Operational safety**
   - Monitor overlapping runs/time budget behavior for the first day after enabling.
   - If overlap occurs, consider reducing `maxDuration` and/or adding a semaphore (follow-on change; do not hot-edit without a rollback plan).

## Output
- A checklist with proof points (redacted) that the cron works end-to-end and does not clobber custom variables.

## Handoff
Proceed to Phase 56c to run the remaining manual smoke tests for the other critical end-to-end flows.

