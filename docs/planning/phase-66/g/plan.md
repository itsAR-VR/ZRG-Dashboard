# Phase 66g — DB Migrations: No Response → Meeting Requested + Remove Day 1 Auto-Email

## Focus
Apply DB migrations so production workspaces match the new Phase 66 workflow:

1) **Stop sending the Day 1 auto-email** from the existing `"Meeting Requested Day 1/2/5/7"` sequences.
2) **Migrate all in-flight default "No Response Day 2/5/7" instances** to `"Meeting Requested Day 1/2/5/7"` so the workflow continues under the unified Meeting Requested flow (preserve progress + schedule; do not restart).
3) Ensure `"No Response Day 2/5/7"` sequences are **disabled** (`isActive=false`) post-migration.

## Inputs
- Sequence names (locked):
  - No Response: `"No Response Day 2/5/7"`
  - Meeting Requested: `"Meeting Requested Day 1/2/5/7"`
- Models:
  - `FollowUpSequence` (name, isActive, triggerOn)
  - `FollowUpStep` (stepOrder, channel, dayOffset, minuteOffset)
  - `FollowUpInstance` (leadId, sequenceId, currentStep, status, nextStepDue, startedAt)
  - `FollowUpTask` (instanceId, stepOrder, status, dueDate)
- Reference patterns to reuse:
  - `scripts/migrate-default-sequence-messaging.ts` (Phase 59) for:
    - CLI flags (`--apply`, `--clientId`, rollback artifact)
    - safe step renumbering (avoid @@unique conflicts)
    - instance/task remapping patterns
  - `actions/followup-sequence-actions.ts` Airtable-mode step deletion logic (remap currentStep safely)

## Work

### Step 1: Add a dedicated migration script
Create a new script:
- `scripts/migrate-followups-phase-66.ts`

CLI contract (match Phase 59 style):
```bash
npx tsx scripts/migrate-followups-phase-66.ts                 # dry-run
npx tsx scripts/migrate-followups-phase-66.ts --apply         # apply all
npx tsx scripts/migrate-followups-phase-66.ts --apply --clientId <uuid>  # canary
npx tsx scripts/migrate-followups-phase-66.ts --rollback <file>          # rollback
```

Env:
- `DIRECT_URL` preferred (fallback to `DATABASE_URL`)

### Step 2: Per-client sequence discovery
For each `clientId` (or the canary client):
- Load:
  - `noResponseSeq` by `name === "No Response Day 2/5/7"`
  - `meetingRequestedSeq` by `name === "Meeting Requested Day 1/2/5/7"`

Handling:
- If `noResponseSeq` is missing: nothing to migrate; still ensure Meeting Requested Day 1 email is removed if `meetingRequestedSeq` exists.
- If `meetingRequestedSeq` is missing but `noResponseSeq` exists:
  - Create the Meeting Requested sequence using the **current** default template shape (Phase 66d) so instances have a valid target.
  - Log this as a “created_missing_meeting_requested_sequence” event in output.

### Step 3: Remove Day 1 auto-email from Meeting Requested sequences (surgical)
For each `meetingRequestedSeq`:
1) Identify the Day 1 auto-email step(s) to remove:
   - `channel === "email"`
   - `dayOffset === 1`
   - `minuteOffset === 0`
2) Delete those steps.
3) Re-sort and re-number remaining steps using the existing scheduling rules:
   - sort by `dayOffset`, then `minuteOffset`, then channel priority (`email`, `sms`, `linkedin`)
   - perform two-phase renumbering to avoid `@@unique([sequenceId, stepOrder])` collisions (same pattern as Airtable-mode step mutation).
4) Remap in-flight `FollowUpInstance.currentStep` for this sequence:
   - Build a map of `oldStepOrder -> newStepOrder` for retained steps
   - If an instance’s `currentStep` points at a deleted stepOrder, snap it to the nearest prior retained stepOrder (see Airtable-mode logic in `actions/followup-sequence-actions.ts`).

Notes:
- Adjust `nextStepDue` only when necessary to avoid “instant send” regressions:
  - For active instances where the deleted Day 1 email was the next step (commonly `currentStep === 0`), recompute a safe `nextStepDue` using the instance’s `startedAt` + the new first-step offset (SMS +2 minutes), and **never pull earlier** than the existing `nextStepDue`.
  - Otherwise keep `nextStepDue` unchanged; the goal is to prevent the Day 1 email from ever being selected/executed again without shifting schedules unexpectedly.

### Step 4: Migrate in-flight No Response instances to Meeting Requested (preserve progress)
For each `noResponseSeq` + `meetingRequestedSeq` pair:

1) Set `noResponseSeq.isActive = false` (No Response is deprecated; manual enablement only).

2) Select in-flight instances to migrate:
   - `FollowUpInstance` where `sequenceId = noResponseSeq.id` and `status IN ('active','paused')`

3) For each instance:
   - If a Meeting Requested instance already exists for the lead:
     - Do **not** create a second instance (unique constraint).
     - Cancel the No Response instance with:
       - `status = 'cancelled'`
       - `pausedReason = 'migrated_to_meeting_requested'`
       - `nextStepDue = null`
     - Move pending tasks (below) to the existing Meeting Requested instance.
   - Else create a Meeting Requested instance that preserves schedule:
     - `startedAt = old.startedAt`
     - `status = old.status`
     - `pausedReason = old.pausedReason`
     - `lastStepAt = old.lastStepAt`
     - `nextStepDue = old.nextStepDue`
     - `currentStep` mapping:
       - Build a step-key map from No Response steps → Meeting Requested steps using:
         - `channel`, `dayOffset`, `minuteOffset`
       - Map the old `currentStep` (last completed step) to the corresponding Meeting Requested stepOrder when possible.
       - Special case: if `old.currentStep === 0`, set the new `currentStep` to the “pre-Day-2 barrier” so Day 1 SMS/LinkedIn are treated as already completed and won’t send for migrated leads:
         - If Meeting Requested has a Day 1 LinkedIn connect step, set `currentStep` to that stepOrder; else set it to the Day 1 SMS stepOrder.
     - Cancel the old No Response instance (same as above).

4) Migrate pending tasks:
   - For `FollowUpTask` where `instanceId = oldNoResponseInstance.id` and `status = 'pending'`:
     - Update `instanceId` to the new/existing Meeting Requested instance id
     - Remap `stepOrder` by the same step-key map when possible; otherwise set `stepOrder = null` (keep `suggestedMessage`, `subject`, `dueDate`)

Leave completed tasks attached to the old instance for audit/history.

### Step 5: Rollback artifacts
Emit a rollback artifact JSON file (same approach as Phase 59):
- sequence step snapshots (before mutation)
- per-instance changes (old/new)
- per-task changes (old/new)

Rollback must:
- restore the Meeting Requested Day 1 email step(s) if they existed
- restore step orders
- restore instance/task mappings
- restore `noResponseSeq.isActive` flags

### Step 6: Operational rollout order
1) Deploy code changes first (Phase 66a–d) so:
   - no new No Response instances start
   - Meeting Requested only starts on setter first email reply
2) Run migration canary: `--apply --clientId <uuid>`
3) Verify canary with queries in Phase 66e
4) Run full migration: `--apply`

## Output

**Completed 2026-01-28:**

1. **Migration script production-ready:** `scripts/migrate-followups-phase-66.ts`
   - Full CLI: `--apply`, `--clientId <uuid>`, `--rollback <file>`
   - Uses `DIRECT_URL` for non-pooled connection

2. **All migration operations implemented:**
   - **Day 1 email removal:** Surgical deletion + two-phase step renumbering
   - **Instance currentStep remapping:** Snaps to nearest prior retained step
   - **No Response → Meeting Requested migration:** Preserves all timing fields
   - **Safe nextStepDue calculation:**
     - Recomputes based on `startedAt` + next step offset
     - Never pulls earlier than existing value
     - If in past, pushes to now + 5 minutes
   - **Task migration:** Updates `instanceId` + remaps `stepOrder` by channel+offset key

3. **Full rollback implemented:**
   - Restores tasks to original instanceId/stepOrder
   - Deletes any migrated Meeting Requested instances
   - Restores original No Response instances (status, currentStep, nextStepDue)
   - Recreates deleted steps with original IDs and ordering
   - Restores sequence isActive flags

4. **Build verification:**
   - `npm run lint`: ✅ 0 errors
   - `npm run build`: ✅ TypeScript + Next.js passed

**Ready for operational rollout:**
1. Deploy Phase 66a-d code changes
2. Run canary: `npx tsx scripts/migrate-followups-phase-66.ts --apply --clientId <uuid>`
3. Verify with Phase 66e queries
4. Run full: `npx tsx scripts/migrate-followups-phase-66.ts --apply`
5. Rollback if needed: `npx tsx scripts/migrate-followups-phase-66.ts --rollback <artifact-file>`

## Handoff
Run Phase 66e verification scenarios and monitor for:
- unexpected Meeting Requested starts (should be only on first setter email reply)
- any remaining active/paused No Response instances after migration
