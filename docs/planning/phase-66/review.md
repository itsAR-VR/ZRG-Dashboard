# Phase 66 — Review

## Summary
- Phase 66 follow-up trigger refactor is implemented in the working tree (uncommitted): Meeting Requested starts on setter **first manual email reply**; sentiment auto-start is disabled; No Response auto-start is disabled while keeping outbound-touch scheduling.
- Verified locally: `npm run lint`, `npm run build`, `npm run test`, `npm run typecheck` all pass.
- `npm run db:push` was attempted because `prisma/schema.prisma` is modified; Prisma blocked the push due to data-loss warnings (no DB changes applied).
- DB migration work is incomplete: `scripts/migrate-followups-phase-66.ts` exists but still needs task migration + rollback completeness + nextStepDue safety before production use.

## What Shipped (Working Tree)
- `lib/followup-automation.ts`: added `handleOutboundTouchForFollowUps()`, added `autoStartMeetingRequestedSequenceOnSetterEmailReply()`, extended `startSequenceInstance(..., { startedAt })`, deprecated sentiment-based auto-start.
- `actions/email-actions.ts`: triggers Meeting Requested on setter email reply; keeps outbound-touch hook.
- `actions/followup-sequence-actions.ts`: removes Meeting Requested Day 1 auto-email; creates No Response default with `isActive: false`; adds `isActive?: boolean` to `createFollowUpSequence`.
- Inbound processors: removed sentiment-based Meeting Requested auto-start call sites:
  - `lib/inbound-post-process/pipeline.ts`
  - `lib/background-jobs/sms-inbound-post-process.ts`
  - `lib/background-jobs/linkedin-inbound-post-process.ts`
  - `app/api/webhooks/email/route.ts`
- `scripts/migrate-followups-phase-66.ts` (untracked): initial migration script scaffold.

## Verification

### Commands (2026-01-27 23:00–23:10 UTC)
- `npm run lint` — pass (0 errors; 18 warnings)
- `npm run build` — pass
- `npm run test` — pass
- `npm run typecheck` — pass
- `npm run db:push` — fail (blocked by Prisma data-loss warning; did not apply)

### Notes
- `npm run db:push` error: Prisma warns about adding new unique constraints on `WorkspaceAvailabilityCache(clientId, availabilitySource)` and `WorkspaceOfferedSlot(clientId, availabilitySource, slotUtc)`; requires cleanup and `--accept-data-loss` to proceed.
- `npm run build` warnings observed:
  - Next.js turbopack root inference due to multiple lockfiles
  - Middleware convention deprecation warning

## Success Criteria → Evidence

1. `autoStartNoResponseSequenceOnOutbound()` no longer auto-starts sequences
   - Evidence: `lib/followup-automation.ts` now delegates to `handleOutboundTouchForFollowUps()` and does not create new instances.
   - Status: met

2. Default "No Response Day 2/5/7" no longer runs automatically (sequence is disabled by default; instances are migrated)
   - Evidence: `actions/followup-sequence-actions.ts` creates No Response with `isActive: false`; outbound auto-start is disabled.
   - Status: partial (DB migration of existing instances/tasks not applied yet)

3. Sentiment change to "Meeting Requested" no longer auto-starts the Meeting Requested sequence (all inbound processors)
   - Evidence: call sites removed from inbound processors; `autoStartMeetingRequestedSequenceIfEligible()` is a no-op backstop.
   - Status: met

4. Setter **first** email reply DOES trigger "Meeting Requested" sequence for eligible leads
   - Evidence: `actions/email-actions.ts` calls `autoStartMeetingRequestedSequenceOnSetterEmailReply()`; function enforces `sentByUserId` and “first reply only”.
   - Status: met (code-level)

5. Day 0 SMS fires immediately (+2 min) after setter reply
   - Evidence: Meeting Requested default template first step is SMS with `dayOffset=1`, `minuteOffset=2`; `startSequenceInstance()` anchors to `message.sentAt`.
   - Status: met (template + scheduling anchor)

6. Day 0 LinkedIn connection fires ~1 hour after setter reply
   - Evidence: Meeting Requested LinkedIn connect step uses `dayOffset=1`, `minuteOffset=60`.
   - Status: met (template)

7. Outbound-touch follow-up scheduling still works for existing active/paused sequences (no regression from disabling no-response auto-start)
   - Evidence: outbound-touch reset/resume logic extracted into `handleOutboundTouchForFollowUps()` and still invoked by `autoStartNoResponseSequenceOnOutbound()`.
   - Status: partial (needs DB-backed runtime verification)

8. Meeting Requested sequences used in production no longer contain the Day 1 auto-email step (migration applied)
   - Evidence: template updated in `actions/followup-sequence-actions.ts`; migration script exists but not applied.
   - Status: partial

9. In-flight No Response instances continue under Meeting Requested without restarting (progress preserved)
   - Evidence: `scripts/migrate-followups-phase-66.ts` includes initial instance migration logic but does not yet migrate pending tasks or provide full rollback.
   - Status: not met

10. `npm run lint` passes
   - Evidence: command run (pass; 0 errors)
   - Status: met

11. `npm run build` passes
   - Evidence: command run (pass)
   - Status: met

12. `npm run test` passes
   - Evidence: command run (pass)
   - Status: met

13. `npm run typecheck` passes
   - Evidence: command run (pass)
   - Status: met

## Plan Adherence
- Planned vs implemented deltas:
  - Phase 66g migration script is present but incomplete (pending task migration, rollback completeness, and nextStepDue safety).
  - DB migration has not been applied (no canary/full run recorded).

## Multi-Agent Coordination Notes
- Working tree contains changes outside Phase 66 scope (notably availability-cache + Prisma schema changes). Despite this, lint/build/test/typecheck are currently green on the combined state.

## Risks / Rollback
- DB migration risk: removing Meeting Requested Day 1 email + migrating instances/tasks requires a complete rollback artifact before running in production.
- Schema push risk: Prisma requires `--accept-data-loss` due to new unique constraints; must audit existing duplicates before applying.

## Follow-ups

**Completed 2026-01-28:**
- [x] Complete `scripts/migrate-followups-phase-66.ts`:
  - [x] Migrate pending `FollowUpTask`s to the Meeting Requested instance (with stepOrder remapping by channel+dayOffset+minuteOffset key)
  - [x] Implement full rollback (recreate deleted steps with original IDs, restore step ordering, delete migrated instances, restore tasks)
  - [x] Add safe `nextStepDue` adjustments:
    - Recompute based on `startedAt` + next step offset
    - Never pull `nextStepDue` earlier than existing value
    - If would be in past, push to now + 5 minutes
- Decide rollout order + canary plan; then run canary migration and verify counts/behavior from Phase 66e queries.

**Script verification:**
- `npm run lint`: ✅ 0 errors
- `npm run build`: ✅ TypeScript + Next.js passed

**Ready for production deployment:**
1. Deploy code changes (Phase 66a-d)
2. Run canary: `npx tsx scripts/migrate-followups-phase-66.ts --apply --clientId <uuid>`
3. Verify with Phase 66e queries
4. Run full: `npx tsx scripts/migrate-followups-phase-66.ts --apply`
5. Rollback if needed: `npx tsx scripts/migrate-followups-phase-66.ts --rollback <artifact-file>`
