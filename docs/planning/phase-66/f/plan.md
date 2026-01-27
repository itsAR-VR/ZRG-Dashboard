# Phase 66f — RED TEAM Addendum: Trigger Audit + Safe Disable/Migration

## Focus
Close the repo-reality gaps discovered during RED TEAM review:

1) Disable **auto-starting new** "No Response" instances without breaking outbound-touch scheduling for other sequences.
2) Ensure **no inbound code path** auto-starts "Meeting Requested" on sentiment change (only setter reply should trigger it).
3) Ensure template timing changes are correct given `lib/followup-schedule.ts` dayOffset semantics.
4) Execute DB migrations so production sequences match the new intent (No Response → Meeting Requested, and remove Day 1 auto-email).

## Inputs
- Root plan: `docs/planning/phase-66/plan.md` (RED TEAM sections)
- Existing implementation:
  - `lib/followup-automation.ts`
  - `lib/followup-schedule.ts`
  - `actions/email-actions.ts`
  - `actions/followup-sequence-actions.ts`
- Known call sites (verify with `rg`):
  - `autoStartNoResponseSequenceOnOutbound`
  - `autoStartMeetingRequestedSequenceIfEligible`
- Migration tooling:
  - `scripts/migrate-default-sequence-messaging.ts` (Phase 59)
  - Phase 66 DB migrations (Phase 66g)

## Work

### Step 1: Re-audit call sites (repo reality)
Run:
```bash
rg -n "autoStartNoResponseSequenceOnOutbound" -S .
rg -n "autoStartMeetingRequestedSequenceIfEligible" -S .
```

Confirm and record the call sites that would still auto-start sequences if we only changed one entrypoint.

### Step 2: Disable "No Response" **auto-start** without breaking outbound-touch scheduling
RED TEAM constraint: `autoStartNoResponseSequenceOnOutbound()` currently does more than start no-response sequences (it also resets/resumes existing instances on human outbound touches).

Implementation (locked):
- Split the function:
  - extract `handleOutboundTouchForFollowUps(...)` for reset/resume behavior
  - keep `autoStartNoResponseSequenceOnOutbound()` as a wrapper that calls the outbound-touch handler and returns `{ started: false, reason: "auto_start_disabled" }` (no new instance creation)

Add a fast rollback strategy:
- Feature flag (env var) to re-enable auto-start if needed (default disabled).

### Step 3: Disable sentiment-based Meeting Requested triggers across ALL inbound processors
Goal: sentiment change to "Meeting Requested" must never start the sequence.

Implementation (locked):
- Disable centrally **and** remove call sites:
  - Central backstop: `autoStartMeetingRequestedSequenceIfEligible()` returns `{ started: false, reason: "sentiment_autostart_disabled" }` and never starts instances.
  - Remove all call sites/imports from:
    - `lib/inbound-post-process/pipeline.ts`
    - `app/api/webhooks/email/route.ts`
    - `lib/background-jobs/sms-inbound-post-process.ts`
    - `lib/background-jobs/linkedin-inbound-post-process.ts`

### Step 4: Make the setter-reply trigger schedule relative to the reply timestamp
RED TEAM risk: `startSequenceInstance()` currently uses `Date.now()` and `new Date()` internally; for Day 0 (+2 min) steps, this can drift from the actual reply `sentAt`.

Implement a `startSequenceInstanceAt(leadId, sequenceId, startedAt)` (or extend `startSequenceInstance`) so:
- `FollowUpInstance.startedAt` is the provided `startedAt`
- `nextStepDue` uses `computeStepOffsetMs(firstStep)` relative to `startedAt`

Then ensure `autoStartMeetingRequestedSequenceOnSetterEmailReply({ ... outboundAt: message.sentAt ... })` uses that timestamp for scheduling.

### Step 5: Update the Meeting Requested sequence template with correct dayOffset semantics
RED TEAM constraint: `lib/followup-schedule.ts` treats `dayOffset` as **day-number**, not “days after”.

When removing the Day 1 email step:
- Keep “immediate” steps on `dayOffset: 1` (or `0` only if needed; prefer staying consistent with other steps).
- Ensure the next follow-up email step is truly **+1 day** after start (`dayOffset: 2`).
- Ensure later steps are at the intended real-world offsets (e.g., +4 days is `dayOffset: 5`).

Update:
- `actions/followup-sequence-actions.ts`: `createMeetingRequestedSequence()` steps + description/comment.

### Step 6: Decide + implement DB migration for existing workspaces
Implementation (locked; see Phase 66g):
- Run DB migrations canary-first with rollback artifacts:
  - remove Day 1 auto-email step from existing Meeting Requested sequences
  - migrate in-flight No Response instances/tasks to Meeting Requested (preserve progress; do not restart)

### Step 7: Re-run Phase 66e validations + add regression checks
After implementing the above, re-run:
```bash
npm run lint
npm run build
```

Add a targeted regression check for outbound-touch scheduling:
- Pick a lead with an active outreach follow-up instance.
- Send a human outbound message.
- Verify `FollowUpInstance.nextStepDue` is pushed/reset (per `resetActiveFollowUpInstanceScheduleOnOutboundTouch` policy).

## Output
- No new "No Response" instances auto-start from outbound events, but outbound-touch scheduling behavior remains intact.
- "Meeting Requested" never auto-starts on sentiment changes from any inbound processor.
- Setter reply starts the sequence at `message.sentAt` so Day 0 steps are aligned to the actual reply time.
- Meeting Requested template no longer contains the Day 1 auto-email step (and DB migration is applied).
- No Response instances are migrated to Meeting Requested so the workflow continues under the unified flow.

## Handoff
Re-run Phase 66e’s validation scenarios (plus the outbound-touch regression check) and prepare a canary rollout checklist (queries + expected counts) for production verification.
