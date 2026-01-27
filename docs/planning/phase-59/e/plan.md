# Phase 59e — Apply Canonical Copy + Timing to Default Sequences (All Sources)

## Focus
Update the default follow-up sequences to match the user’s canonical copy across **email + SMS + LinkedIn**, including Day 1 exact timing (SMS +2m, LinkedIn +60m).

This subphase updates **all sources of truth** so templates don’t drift:

- `actions/followup-sequence-actions.ts` (default sequence constructors)
- `lib/followup-sequence-linkedin.ts` (LinkedIn-step backfill helper used in production)
- `scripts/backfill-linkedin-sequence-steps.ts` (one-off script; keep consistent)

## Inputs
- Phase 59 root plan “Reference: User’s Canonical Messaging”
- Timing infra from Phase 59d (`FollowUpStep.minuteOffset`, cron cadence)
- Existing default sequence names:
  - `No Response Day 2/5/7`
  - `Meeting Requested Day 1/2/5/7`
  - `Post-Booking Qualification`

## Work

### 1) Normalize placeholders to repo-standard syntax
- Use existing placeholders (do not introduce new ones unless required):
  - `{firstName}`, `{senderName}`, `{companyName}`, `{calendarLink}`, `{availability}`, `{result}`, `{qualificationQuestion1}`, `{qualificationQuestion2}`
- Ensure the canonical copy uses repo placeholders (no `{{contact.first_name}}`, no `{FIRST_NAME}`).

### 2) Update default “Meeting Requested Day 1/2/5/7” sequence
- Ensure Day 1 contains the three required touches with minute offsets:
  - Day 1 email: `minuteOffset=0`
  - Day 1 SMS: `minuteOffset=2`, `condition=phone_provided`
  - Day 1 LinkedIn connect: `minuteOffset=60`
- Canonical Day 2/5/7 steps:
  - Day 2 email asks for the best phone number (exact copy)
  - Day 2 SMS asks when is a good time to call (phone only)
  - Day 2 LinkedIn follow-up only if connected (exact copy)
  - Day 5 email + SMS (exact copy; include `{availability}` and `{calendarLink}`)
  - Day 7 email + SMS (exact copy)
- RED TEAM: email subjects
  - Keep existing subjects unless canonical subjects are explicitly provided (body copy is the priority).

### 3) Update default “No Response Day 2/5/7” sequence
- Update Day 2/5/7 email + SMS bodies to the canonical copy (same as root reference).
- LinkedIn:
  - Remove any extra Day 5/7 LinkedIn steps not mentioned in the canonical workflow.
  - Keep a single Day 2 LinkedIn step that follows up only if connected (`linkedin_connected`) using the canonical Day 2 copy.

### 4) Update default “Post-Booking Qualification” sequence
- Update the email body to match canonical copy exactly (no extra sign-off lines).
- Keep subject unless canonical subject is provided.

### 5) Update LinkedIn backfill helpers to match defaults
- Update `lib/followup-sequence-linkedin.ts` and `scripts/backfill-linkedin-sequence-steps.ts` so their LinkedIn steps match:
  - Meeting Requested: Day 1 connection note copy (with minuteOffset support if the helper evolves to include it; otherwise ensure dayOffset and copy match)
  - No Response: Day 2 connected-only follow-up copy

### 6) Drift prevention validation
- Add a grep-based validation checklist (and optionally a unit test) to ensure old template strings no longer exist:
  - `rg` for the previous default LinkedIn templates
  - `rg` for legacy signatures/extra lines removed from the canonical copy

## Validation (RED TEAM)
- `rg` confirms no old default follow-up copy remains in:
  - `actions/`
  - `lib/`
  - `scripts/`
- `npm run lint`
- `npm run build`

## Output

### Completed
- [x] Updated `actions/followup-sequence-actions.ts`:
  - `defaultNoResponseLinkedInSteps()` → single Day 2 step with `linkedin_connected` condition and canonical copy
  - `defaultMeetingRequestedLinkedInSteps()` → Day 0 with `minuteOffset=60` and canonical copy
  - `createMeetingRequestedSequence()` → Day 0 SMS with `minuteOffset=2`, Day 2/5/7 canonical bodies
  - `createDefaultSequence()` → Day 2 canonical email body
  - `createPostBookingSequence()` → Removed extra sign-off lines
- [x] Updated `lib/followup-sequence-linkedin.ts`:
  - Both default functions updated to canonical copy with `minuteOffset` support
  - Sorting includes `minuteOffset` in priority order
- [x] Updated `scripts/backfill-linkedin-sequence-steps.ts`:
  - Templates match canonical copy exactly
  - Added `minuteOffset` to type, sorting, and step creation
- [x] Validation passed:
  - `npm run lint` → 0 errors (only pre-existing warnings)
  - `npm run build` → success
  - Grep confirms old templates removed from `actions/`, `lib/`, `scripts/`

### Files Modified
- `actions/followup-sequence-actions.ts`
- `lib/followup-sequence-linkedin.ts`
- `scripts/backfill-linkedin-sequence-steps.ts`

## Handoff
Phase 59f migrates production DB: overwrite existing default sequences, update in-flight instances/tasks, and provide rollback/runbook so production is safe.

