# Phase 66 — Follow-Up Sequencing Trigger Refactor

## Purpose
Refactor the follow-up sequencing system to:
1) migrate all legacy "No Response Day 2/5/7" flows into "Meeting Requested Day 1/2/5/7" flows (and keep No Response disabled by default for new workspaces),
2) trigger "Meeting Requested" when the setter sends their **first manual email reply** (not on sentiment change),
3) remove the Day 1 auto-email step from the Meeting Requested sequence template (since the setter's manual reply IS the first touchpoint),
4) run a DB migration so existing workspaces stop sending the Day 1 auto-email and any in-flight No Response instances continue under Meeting Requested.

## Context
**Problem Statement (from partner transcript):**

The current follow-up sequencing has conceptual issues:

1. **"No Response" sequence is broken:**
   - Day 2 SMS sends "when's a good time to call?" from an unknown number - lead ignores it
   - Day 2 LinkedIn only fires if already connected (they won't be)
   - "we'll never use that, because SMS and LinkedIn don't make any sense for that"

2. **"Meeting Requested" sequence has wrong trigger:**
   - Currently triggers when sentiment changes to "Meeting Requested"
   - But Day 1 Email is a template that can't be customized per lead
   - "this shouldn't be an automated step... it should be manually-triggered by us"
   - The setter's manual reply SHOULD be what triggers the sequence, not part of it

**Desired Flow:**
1. Cold email goes out from ESP (SmartLead/Instantly)
2. Lead replies with interest → sentiment becomes positive (commonly "Interested" or "Meeting Requested")
3. Setter manually crafts and sends reply email (using AI draft or manual)
4. **This outbound email triggers the "Meeting Requested" sequence**
5. Sequence fires: SMS (now Day 0), LinkedIn (now Day 0), then Day 1+ steps

**Technical Root Cause:**
- "Meeting Requested" auto-start currently happens on **sentiment change** (multiple entrypoints), via:
  - `autoStartMeetingRequestedSequenceIfEligible()` in `lib/followup-automation.ts`
  - called from: `lib/inbound-post-process/pipeline.ts`, `app/api/webhooks/email/route.ts`, `lib/background-jobs/sms-inbound-post-process.ts`, `lib/background-jobs/linkedin-inbound-post-process.ts`
- "No Response" auto-start currently happens on **outbound touches** (multiple entrypoints), via:
  - `autoStartNoResponseSequenceOnOutbound()` in `lib/followup-automation.ts`
  - called from: `actions/email-actions.ts`, `actions/message-actions.ts`, `actions/crm-actions.ts`, `app/api/webhooks/email/route.ts` (EMAIL_SENT), `app/api/webhooks/smartlead/route.ts`, `app/api/webhooks/instantly/route.ts`, `lib/webhook-events/inboxxia-email-sent.ts`, etc.
- **Critical nuance:** despite the name, `autoStartNoResponseSequenceOnOutbound()` also resets/resumes *existing* follow-up instances on human outbound; disabling "No Response" must preserve that behavior.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 62 | In progress (uncommitted) | `lib/inbound-post-process/pipeline.ts` | Coordinate any edits to pipeline stages/imports |
| Phase 63 | Complete | `lib/ai-drafts.ts`, `lib/ai/prompt-runner/*` | No overlap with follow-up sequencing |
| Phase 64 | In progress | `lib/ai-drafts.ts`, `lib/booking-process-instructions.ts` | No direct overlap; Phase 64 is about booking links |
| Phase 65 | In progress | `lib/ai/prompt-runner/runner.ts` | No overlap with follow-up sequencing |
| Phase 59 | Complete | `lib/followup-schedule.ts`, `actions/followup-sequence-actions.ts` | Day offset semantics are day-number (Day 1 = 0 days); use this when renumbering |

**Files this phase will touch:**
- `lib/followup-automation.ts` — Disable *starting new* no-response instances (keep outbound-touch scheduling), add setter-reply trigger (and likely a `startSequenceInstance(..., startedAt)` variant)
- `actions/email-actions.ts` — Add meeting-requested-on-reply trigger call (keep outbound-touch hook)
- `actions/followup-sequence-actions.ts` — Update Meeting Requested default template + description/comment (remove the auto Day 1 Email step)
- Remove/neutralize sentiment-based Meeting Requested triggers:
  - `lib/inbound-post-process/pipeline.ts`
  - `app/api/webhooks/email/route.ts`
  - `lib/background-jobs/sms-inbound-post-process.ts`
  - `lib/background-jobs/linkedin-inbound-post-process.ts`
- DB migrations (required):
  - `scripts/migrate-followups-phase-66.ts` (new) — remove Day 1 auto-email from Meeting Requested, migrate No Response instances/tasks to Meeting Requested, disable No Response sequences (canary-first + rollback)

## Pre-Flight Conflict Check (Multi-Agent)

- [ ] Run `git status --porcelain` and confirm no unexpected uncommitted changes to follow-up files
- [ ] Verify no active phases are modifying follow-up-related files

## Execution Notes (RED TEAM)

- Before implementing subphases a–d, complete **Phase 66f Step 1** (repo-wide call-site audit) and reconcile any mismatches.
- Do **not** make `autoStartNoResponseSequenceOnOutbound()` a blanket no-op; it also handles outbound-touch scheduling for existing follow-up instances (see Phase 66f Step 2).
- Any “Day 0/1/4/6” renumbering must be reviewed against `lib/followup-schedule.ts` dayOffset semantics (see Phase 66f Step 5).

## Objectives
* [ ] Disable **auto-starting new** "No Response" follow-up instances (keep outbound-touch scheduling behavior)
* [ ] Migrate default "No Response Day 2/5/7" sequences/instances/tasks → "Meeting Requested Day 1/2/5/7"
* [ ] Remove sentiment-based Meeting Requested auto-start (`autoStartMeetingRequestedSequenceIfEligible`) across all entrypoints
* [ ] Create new `autoStartMeetingRequestedSequenceOnSetterEmailReply()` trigger (first setter email reply only)
* [ ] Add trigger call **only** in the email reply send path (no SMS/LinkedIn trigger)
* [ ] Update default "Meeting Requested" template to remove Day 1 auto-email step (setter reply is the first touchpoint)
* [ ] Ensure default "No Response" sequence is created **disabled** for new workspaces (manual-use only)

## Decisions (Locked) (2026-01-27)

- **No Response is deprecated:** migrate all default No Response flows into Meeting Requested, and keep "No Response Day 2/5/7" disabled upon creation for new workspaces.
- **Trigger definition:** Meeting Requested auto-start is only on the **first setter manual email reply** (dashboard send; not outbound SMS/LinkedIn).
- **DB migrations required:**
  - Existing Meeting Requested sequences must stop sending the Day 1 auto-email step.
  - In-flight No Response instances must continue as Meeting Requested (preserve progress + schedule; do not restart).
- **Migration scope:** default-only (sequence name `"No Response Day 2/5/7"`).

## Constraints
- Must work with both GHL and Calendly booking providers
- Backward compatible: leads already in sequences should continue normally after migration (no duplicate touches)

## Non-Goals
- Changing how sequences execute once started
- Modifying the Post-Booking Qualification sequence
- Changing any UI components for sequence management

## Success Criteria
- [x] `autoStartNoResponseSequenceOnOutbound()` no longer auto-starts sequences
- [ ] Default "No Response Day 2/5/7" no longer runs automatically (sequence is disabled by default; instances are migrated)
- [x] Sentiment change to "Meeting Requested" no longer auto-starts the Meeting Requested sequence (all inbound processors)
- [x] Setter **first** email reply DOES trigger "Meeting Requested" sequence for eligible leads
- [x] Day 0 SMS fires immediately (+2 min) after setter reply
- [x] Day 0 LinkedIn connection fires ~1 hour after setter reply
- [ ] Outbound-touch follow-up scheduling still works for existing active/paused sequences (no regression from disabling no-response auto-start)
- [ ] Meeting Requested sequences used in production no longer contain the Day 1 auto-email step (migration applied)
- [ ] In-flight No Response instances continue under Meeting Requested without restarting (progress preserved)
- [x] `npm run lint` passes
- [x] `npm run build` passes
- [x] `npm run test` passes
- [x] `npm run typecheck` passes

## Subphase Index
* a — Deprecate No Response auto-start (keep outbound-touch scheduling)
* b — Remove sentiment-based trigger for "Meeting Requested" (all entrypoints)
* c — Create and integrate setter-email-reply trigger (first reply only)
* d — Update default templates (Meeting Requested minus Day 1 email; No Response disabled by default)
* e — Validation and testing
* f — RED TEAM addendum: repo-wide trigger audit + safe disable/migration
* g — DB migrations: No Response → Meeting Requested + remove Day 1 auto-email

## Repo Reality Check (RED TEAM)

### What exists today
- Follow-up auto-start + outbound-touch scheduling:
  - `lib/followup-automation.ts`: `autoStartNoResponseSequenceOnOutbound()`, `autoStartMeetingRequestedSequenceIfEligible()`, `startSequenceInstance()`
- Scheduling semantics:
  - `lib/followup-schedule.ts`: `dayOffset=1` means Day 1 (0 days after start); `dayOffset=2` is +1 day; `dayOffset=0` is also immediate (back-compat)
- Meeting Requested template lives in DB (code templates only affect *newly created* sequences):
  - `actions/followup-sequence-actions.ts`: `createMeetingRequestedSequence()`
  - Existing workspaces already have a `FollowUpSequence` + `FollowUpStep[]` persisted
- Existing migration tooling (reference):
  - `scripts/migrate-default-sequence-messaging.ts` (Phase 59)
- Phase 66 migration tooling (to add):
  - `scripts/migrate-followups-phase-66.ts` (Phase 66g)

### Verified touch points (files + identifiers)
- `actions/email-actions.ts`: `sendEmailReplyInternal()` calls:
  - `autoStartNoResponseSequenceOnOutbound(...)` (Phase 66: outbound-touch scheduling only; no new No Response instances)
  - `autoStartMeetingRequestedSequenceOnSetterEmailReply(...)` (Phase 66: new trigger)
- `app/api/webhooks/email/route.ts`: calls `autoStartNoResponseSequenceOnOutbound(...)` on EMAIL_SENT (Phase 66: sentiment Meeting Requested trigger removed)
- `lib/inbound-post-process/pipeline.ts`: sentiment Meeting Requested trigger removed (Phase 66b)
- `lib/background-jobs/sms-inbound-post-process.ts`: sentiment Meeting Requested trigger removed (Phase 66b)
- `lib/background-jobs/linkedin-inbound-post-process.ts`: sentiment Meeting Requested trigger removed (Phase 66b)
- `autoStartMeetingRequestedSequenceIfEligible(...)`: centrally disabled; no runtime call sites remain (docs references only)

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Disabling `autoStartNoResponseSequenceOnOutbound()` via early return breaks unrelated behavior** (it also resets/resumes existing follow-up instances on human outbound touches) → disable *only the new no-response instance creation path*, keep outbound-touch scheduling intact.
- **Sentiment-based Meeting Requested trigger exists in multiple places** (not just `lib/inbound-post-process/pipeline.ts`) → remove/neutralize all call sites or disable the function centrally so no inbound path can auto-start the sequence.
- **Day-number vs day-offset confusion** (`dayOffset=1` is already “Day 0” in calendar time) → when renumbering (Day 0/1/4/6), ensure `dayOffset` values still schedule at the intended real-world times.
- **Updating code templates alone won’t change existing sequences in production** → run DB migrations (Phase 66g) so Meeting Requested stops sending the Day 1 auto-email and in-flight No Response instances continue under Meeting Requested.

### Missing or ambiguous requirements
- Define “setter reply” precisely (**resolved**):
  - Only outbound email replies sent via `actions/email-actions.ts:sendEmailReplyInternal()` (manual dashboard send; `sentByUserId` present).
  - Outbound SMS/LinkedIn do **not** trigger Meeting Requested auto-start (they are sequence steps, not triggers).
- Define behavior if a Meeting Requested instance already exists (**default**): do not restart; return a reason and leave the existing instance untouched.
- Rollout strategy: ship code first (no new No Response starts), then run DB migrations canary-first with rollback artifacts.

### Testing / validation gaps
- Expand Scenario 2 to cover *all* inbound processors (email webhook + SMS + LinkedIn), not just one.
- Add a regression check for outbound-touch scheduling (active instance nextStepDue reset on human outbound).
- Add a canary DB query/checklist for “unexpected FollowUpInstance creations” immediately after deploy.

## Open Questions (Need Human Input)
- None (locked 2026-01-27).

## Assumptions (Agent)

- `lib/followup-schedule.ts` dayOffset semantics (Day 1 = 0 days) are the current source of truth for scheduling. (confidence ~95%)
  - Mitigation check: confirm new `dayOffset`/`minuteOffset` values yield the intended timestamps via a small unit test or a console calculation in a script.
- Disabling the *new* no-response start path is enough to meet "No Response auto-start disabled" while preserving valuable outbound-touch scheduling behavior. (confidence ~90%)
  - Mitigation check: verify no new `FollowUpInstance` rows are created for `triggerOn="no_response"` after outbound events, but active instances still reset on human outbound.

---

## Phase Summary

**Shipped (in working tree) — 2026-01-28:**
- Removed sentiment-based Meeting Requested auto-start; added setter-email-reply trigger (first reply only)
- Disabled No Response auto-start while preserving outbound-touch scheduling; default No Response now created disabled
- Updated Meeting Requested default template to remove Day 1 auto-email
- **Migration script production-ready:** `scripts/migrate-followups-phase-66.ts`
  - Task migration with stepOrder remapping
  - Full rollback (recreate steps, restore instances/tasks)
  - Safe nextStepDue adjustments (never earlier, push past dates forward)

**Verified (2026-01-28):**
- `npm run lint`: ✅ pass (0 errors; 18 pre-existing warnings)
- `npm run build`: ✅ pass

**Ready for deployment:**
1. Merge code changes to main
2. Deploy to production
3. Run canary: `npx tsx scripts/migrate-followups-phase-66.ts --apply --clientId <uuid>`
4. Verify with Phase 66e queries
5. Run full migration: `npx tsx scripts/migrate-followups-phase-66.ts --apply`
