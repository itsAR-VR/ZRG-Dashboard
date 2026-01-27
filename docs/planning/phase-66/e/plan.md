# Phase 66e — Validation and Testing

## Focus
Validate all Phase 66 changes (code + DB migrations) and document production verification scenarios.

## Inputs
- Phase 66a completed: No Response auto-start disabled (outbound-touch scheduling preserved)
- Phase 66b completed: sentiment-based Meeting Requested auto-start removed/disabled across inbound processors
- Phase 66c completed: setter **first email reply** trigger added
- Phase 66d completed: default templates updated (Meeting Requested minus Day 1 auto-email; No Response disabled by default)
- Phase 66g completed: DB migrations applied (No Response → Meeting Requested; remove Day 1 auto-email)

## Work

### Step 1: Run lint, build, test, typecheck

```bash
npm run lint
npm run build
npm run test
npm run typecheck
```

Fix any errors that arise.

### Step 2: Verify code changes

**Check all modified files:**
- [ ] `lib/followup-automation.ts`:
  - `autoStartNoResponseSequenceOnOutbound()` does not create new instances (but still handles outbound-touch scheduling via extracted helper)
  - `autoStartMeetingRequestedSequenceIfEligible()` is disabled (sentiment no longer starts sequences)
  - `autoStartMeetingRequestedSequenceOnSetterEmailReply()` exists and anchors scheduling to `message.sentAt`
- [ ] Inbound processors do not auto-start Meeting Requested:
  - `lib/inbound-post-process/pipeline.ts`
  - `app/api/webhooks/email/route.ts`
  - `lib/background-jobs/sms-inbound-post-process.ts`
  - `lib/background-jobs/linkedin-inbound-post-process.ts`
- [ ] `actions/email-actions.ts`: calls the new setter-email-reply trigger (first reply only)
- [ ] `actions/followup-sequence-actions.ts`:
  - `createMeetingRequestedSequence()` has no Day 1 auto-email step
  - `createDefaultSequence()` creates No Response disabled (manual-use only)
  - `createFollowUpSequence()` supports `isActive?: boolean` (defaults true)

### Step 3: Manual testing scenarios (post-deploy)

**Scenario 1: No Response should not run automatically**
1. Create a lead with any sentiment
2. Send an outbound email/SMS
3. Verify: No "No Response" sequence instance created automatically
4. Verify: No Response template exists but is disabled by default in new workspaces
5. Verify: Outbound-touch scheduling still works for existing sequences (no regression)

**Scenario 2: Sentiment change should NOT trigger Meeting Requested sequence (all inbound paths)**
1. Create a lead with "New" sentiment
2. Receive inbound message that changes sentiment to "Meeting Requested" (email webhook, SMS post-process, LinkedIn post-process)
3. Verify: No "Meeting Requested" sequence instance created automatically

**Scenario 3: Setter first email reply SHOULD trigger Meeting Requested sequence**
1. Create a lead with positive sentiment ("Interested" or "Meeting Requested")
2. Have a setter send an email reply via the dashboard
3. Verify: "Meeting Requested" sequence instance created exactly once
4. Verify: Second setter reply does NOT start another instance
5. Verify: First step (SMS) is scheduled for ~2 minutes after the reply (`startedAt` anchored)
6. Verify: LinkedIn connect step (if configured) is scheduled for ~1 hour after the reply

**Scenario 4: Guards should prevent inappropriate triggers**
1. Lead with `autoFollowUpEnabled = false` → setter sends reply → Verify: No sequence started
2. Lead with negative sentiment/status (Not Interested / Blacklist) → setter sends reply → Verify: No sequence started
3. Lead with meeting already booked → setter sends reply → Verify: No sequence started

**Scenario 5: Migration — No Response instances continue under Meeting Requested**
1. Identify a lead currently in an active/paused No Response instance pre-migration
2. Run Phase 66g migration canary
3. Verify: No Response instance is cancelled/migrated; Meeting Requested instance exists with preserved progress (no restart)
4. Verify: No immediate “Day 1” SMS/LinkedIn steps are injected as a restart side-effect

### Step 4: Database verification queries (post-deploy)

```sql
-- Recent follow-up instances created after deploy (sanity check)
SELECT
  fi.id,
  fi."leadId",
  fi."sequenceId",
  fi.status,
  fi."startedAt",
  fs.name as sequence_name
FROM "FollowUpInstance" fi
JOIN "FollowUpSequence" fs ON fi."sequenceId" = fs.id
WHERE fi."startedAt" >= NOW() - INTERVAL '1 hour'
ORDER BY fi."startedAt" DESC
LIMIT 50;

-- Confirm no active/paused No Response instances remain after migration
SELECT
  fs.name as sequence_name,
  fi.status,
  COUNT(*) as count
FROM "FollowUpInstance" fi
JOIN "FollowUpSequence" fs ON fi."sequenceId" = fs.id
WHERE fs.name = 'No Response Day 2/5/7'
  AND fi.status IN ('active','paused')
GROUP BY 1,2
ORDER BY 3 DESC;
```

### Step 5: Documentation

Update any relevant documentation:
- [ ] Add note in `CLAUDE.md` about the new follow-up trigger behavior (if appropriate)
- [ ] Consider adding a runbook for this phase in `docs/planning/phase-66/runbook.md`

## Output
- Verification (2026-01-27 23:00–23:10 UTC):
  - `npm run lint`: pass (0 errors; 18 warnings)
  - `npm run build`: pass
  - `npm run test`: pass
  - `npm run typecheck`: pass
  - `npm run db:push`: fail (Prisma data loss warnings; no DB changes applied)
- Evidence: `docs/planning/phase-66/review.md`

## Handoff
Phase 66f is the audit phase (already completed as part of phase execution pre-flight).
Phase 66g creates the DB migration script for existing workspaces.
