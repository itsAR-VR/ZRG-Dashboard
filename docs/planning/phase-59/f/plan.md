# Phase 59f — Production Migration: Overwrite Sequences + Update In-Flight Sends (Tasks/Instances) + Rollback

## Focus
Ship a production-safe migration that:

1) overwrites the existing default sequences with the new canonical copy + timing,
2) updates any in-flight scheduled work so upcoming sends reflect the new messaging/timing,
3) provides rollback artifacts and a runbook so nothing breaks in production.

## Inputs
- Canonical templates + timing from Phase 59e
- Timing infra from Phase 59d (`minuteOffset`, cron cadence)
- Data model:
  - `FollowUpSequence`, `FollowUpStep`, `FollowUpInstance`, `FollowUpTask`
- Script patterns:
  - Use `tsx` + dotenv pattern from `scripts/migrate-appointments.ts`

## Work

### 1) Implement a production migration script (tsx)
- Create `scripts/migrate-default-sequence-messaging.ts` (tsx).
- Flags:
  - `--dry-run` (default)
  - `--apply`
  - `--clientId <uuid>` (optional scope/canary)
  - `--rollback <file>` (apply rollback file; optional but strongly recommended)
- DB env:
  - Prefer `DIRECT_URL`, fallback to `DATABASE_URL`
  - Load `.env.local` then `.env`

### 2) Overwrite the default sequences (per client)
For each workspace:
- Find sequences by default names:
  - `No Response Day 2/5/7`
  - `Meeting Requested Day 1/2/5/7`
  - `Post-Booking Qualification`
- Overwrite their steps to match Phase 59e:
  - update `dayOffset`, `minuteOffset`, `channel`, `condition`, `subject`, `messageTemplate`, `requiresApproval`
  - ensure `stepOrder` matches the new (dayOffset, minuteOffset, channel) sorting
- RED TEAM: stepOrder remapping
  - `FollowUpInstance.currentStep` is stepOrder-based; if stepOrder changes, remap currentStep safely.
  - Avoid “retro-inserting” new early steps into already-progressed instances by default (prevents surprise spam).

### 3) Update in-flight instances to keep scheduling correct
- Target:
  - Instances where `sequence.name IN (default names)` and `status IN ('active', 'paused')`
- After sequence overwrite:
  - Recompute `nextStepDue` for each instance based on the *next* step after `currentStep`, using `(dayOffset, minuteOffset)` spacing.
  - If the next step is overdue, set `nextStepDue = now` (so cron can pick it up) but rely on:
    - business-hours rescheduling logic
    - per-channel rate limiting (`canSendFollowUp`) to prevent bursts
- Special case: paused instances
  - If paused for reasons unrelated to scheduling (`awaiting_approval`, `linkedin_unreachable`, etc.), do not resume automatically; only update their metadata where safe.

### 4) Update pending FollowUpTasks so “scheduled to go out” copy is updated
- Target:
  - `FollowUpTask.status='pending'` with `instanceId` set and instances/sequences in-scope
- Strategy:
  - Map task → step using the (possibly remapped) `stepOrder`
  - Re-render `suggestedMessage` and `subject` from the updated `FollowUpStep` templates:
    - Use lead data + workspace settings placeholders the same way `generateFollowUpMessage()` does
  - Do not change completed tasks.

### 5) Rollback artifacts + audit log
- In `--apply`, write a rollback JSON file containing:
  - sequence id/name/clientId
  - each updated step’s id and previous values (`messageTemplate`, `subject`, `condition`, `dayOffset`, `minuteOffset`, `stepOrder`)
  - each updated instance’s id and previous values (`currentStep`, `nextStepDue`, `status`, `pausedReason`)
  - each updated task’s id and previous values (`suggestedMessage`, `subject`, `stepOrder`)
- In `--rollback`, apply the inverse changes.

### 6) Production runbook (do not skip)
1. **Canary**: run `--dry-run --clientId <test-workspace>`
2. Verify output counts + sample diffs.
3. Run `--apply --clientId <test-workspace>` and verify in DB.
4. Full `--dry-run` (all workspaces), confirm counts.
5. Full `--apply`, save rollback artifact.
6. Run verification SQL (from Phase 59b) + spot-check UI.
7. Monitor follow-ups cron logs for:
   - error spikes
   - rate-limit reschedules
   - unexpected “overdue” floods

## Validation (RED TEAM)
- Repo: `npm run lint`, `npm run build`
- Migration dry-run output:
  - total sequences found
  - steps rewritten per sequence
  - instances/tasks updated counts
- DB verification query:
  - confirm `messageTemplate` values match canonical copy across day offsets and channels
- Smoke:
  - pick a lead with an active instance and confirm the next scheduled send reflects updated template text

## Output

### Completed
- [x] Created `scripts/migrate-default-sequence-messaging.ts`
  - `--dry-run` (default) previews changes
  - `--apply` executes the migration
  - `--clientId <uuid>` scopes to a single workspace (canary)
  - `--rollback <file>` restores from rollback artifact
- [x] Overwrites sequence steps with canonical templates from Phase 59e
- [x] Updates in-flight `FollowUpInstance.nextStepDue` based on new step timing
- [x] Updates pending `FollowUpTask.suggestedMessage` with new template copy
- [x] Generates JSON rollback artifact with full restoration data
- [x] `npm run lint` passes (0 errors)
- [x] `npm run build` passes

### Files Created
- `scripts/migrate-default-sequence-messaging.ts`

### Usage
```bash
# Dry-run (default) - preview changes
npx tsx scripts/migrate-default-sequence-messaging.ts

# Canary - single workspace
npx tsx scripts/migrate-default-sequence-messaging.ts --apply --clientId <uuid>

# Full migration
npx tsx scripts/migrate-default-sequence-messaging.ts --apply

# Rollback from artifact
npx tsx scripts/migrate-default-sequence-messaging.ts --rollback rollback-sequence-messaging-<timestamp>.json
```

## Handoff
Phase 59 complete; ready for production enablement. If any unexpected bursts occur, run `--rollback` immediately and restore cron cadence while triaging.

