# Phase 59 — Standardize Default Follow-Up Sequence Messaging

## Purpose
Update all default follow-up sequence templates to match the exact messaging copy provided by the user, and migrate all existing default sequences in the database to use the new standardized copy.

## Context
The current default follow-up sequences in `actions/followup-sequence-actions.ts` have messaging that differs from the user's canonical sales playbook. The user provided exact copy for:

1. **Day 1 (Meeting Requested)**: Initial response with LinkedIn connection and SMS
2. **Day 2 (No Response)**: Ask for phone number, SMS follow-up, LinkedIn check
3. **Day 5 (No Response)**: Availability reminder via email + SMS
4. **Day 7 (No Response)**: Final check-in via email + SMS
5. **Post-Booking**: Confirmation + qualification questions

Key messaging changes requested:
- LinkedIn connection: "Hi {firstName}, just wanted to connect on here too as well as over email"
- Day 1 SMS: "Hi {firstName}, it's {senderName} from {companyName}, I just sent over an email but wanted to drop a text too incase it went to spam - here's the link {calendarLink}"
- Day 2 LinkedIn: Follow up if connected (check connection status)
- All copy to match the user's exact wording

**Source of truth:** the canonical copy to use verbatim is in `Follow-Up Sequencing.md` (repo root).

**Two-part implementation required:**
1. Update code templates (for new workspaces)
2. Migrate existing sequences (for current workspaces using default sequences)

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 58 | Complete | Calendar link handling | No conflict; uses `{calendarLink}` placeholder |

## Pre-Flight Conflict Check (Multi-Agent)

- Start Phase 59 from a clean working tree:
  - `git status --porcelain` should be empty (or only contain the Phase 59 planning docs).
- Scan the last 10 phases for overlap before touching shared areas like `actions/*`, `lib/*`, or `prisma/schema.prisma`:
  - `ls -dt docs/planning/phase-* | head -10`

## Objectives
* [ ] Update `defaultNoResponseLinkedInSteps()` to match new messaging
* [ ] Update `defaultMeetingRequestedLinkedInSteps()` to match new messaging
* [ ] Update `createDefaultSequence()` (No Response) email/SMS templates
* [ ] Update `createMeetingRequestedSequence()` email/SMS templates
* [ ] Update `createPostBookingSequence()` email template
* [ ] Update LinkedIn step template duplicates in `lib/followup-sequence-linkedin.ts` and `scripts/backfill-linkedin-sequence-steps.ts`
* [ ] Implement exact intra-day timing support (2 min SMS, 1 hr LinkedIn) for FollowUpStep scheduling
* [ ] Increase `/api/cron/followups` cadence (current `*/10 * * * *`) to support minute-level precision
* [ ] Keep existing email subjects unchanged
* [ ] Ensure message bodies match `Follow-Up Sequencing.md` verbatim (including punctuation + line breaks)
* [ ] Create migration script to update existing default sequences in database
* [ ] Run migration (dry-run → apply) on production DB with rollback support
* [ ] Verify all sequences use standardized copy

## Constraints
- **Canonical copy**: Message bodies must match `Follow-Up Sequencing.md` verbatim.
- **Subjects unchanged**: Do not change existing `FollowUpStep.subject` (keep current subjects).
- **Placeholder aliasing**: Implement runtime aliasing so the templates can remain verbatim while still rendering correctly (doc placeholders like `{FIRST_NAME}`, `{name}`, `{company}`, `{link}`, `{time 1 day 1}`, `{x day x time}`, etc.).
- **Overwrite + update**: Migration should overwrite and update the existing default sequences (including edited variants) and any pending scheduled tasks so the next sends use the new copy.
- **Timing must match**: Day 1 must schedule SMS **+2 minutes** after the Day 1 email, and LinkedIn connect **+1 hour** after the Day 1 email.
- **No surprises**: Avoid retroactively re-sending already-completed steps; update future/pending sends.
- **LinkedIn conditional logic**: LinkedIn **DM** steps should use `linkedin_connected` (connection requests, if used, may be `always`)

## Success Criteria
- [x] Code templates in `actions/followup-sequence-actions.ts` match user's exact messaging
- [x] Migration script updates all existing default sequences (dry-run verified; apply pending)
- [x] New workspaces get the correct copy automatically
- [ ] Existing workspaces' default sequences are updated (requires running migration with `--apply`)
- [x] `npm run lint` passes
- [x] `npm run build` passes

## Subphase Index
* a — Update code templates in `actions/followup-sequence-actions.ts`
* b — Create and run migration script for existing sequences
* c — RED TEAM hardening: repo reality fixes, missing-copy resolution, and migration safety/rollback
* d — Add precise timing support (minute offsets) + update cron cadence
* e — Apply the finalized canonical copy across `actions/`, `lib/`, and `scripts/` (supersedes 59a details where they differ)
* f — Production-grade migration: overwrite sequences + update in-flight instances/tasks + rollback/runbook (supersedes 59b details where they differ)
* g — Canonical copy ingestion: use `Follow-Up Sequencing.md` verbatim + placeholder aliasing + slot placeholder support
* h — Production readiness: implement remaining gaps + verify end-to-end

## Repo Reality Check (RED TEAM)

- What exists today:
  - Default sequence templates live in `actions/followup-sequence-actions.ts`:
    - `defaultNoResponseLinkedInSteps()`
    - `defaultMeetingRequestedLinkedInSteps()`
    - `createDefaultSequence()`
    - `createMeetingRequestedSequence()`
    - `createPostBookingSequence()`
  - LinkedIn default-step templates are duplicated in:
    - `lib/followup-sequence-linkedin.ts` (used by `ensureDefaultSequencesIncludeLinkedInStepsForClient`)
    - `scripts/backfill-linkedin-sequence-steps.ts` (one-off backfill script)
  - Data model is `FollowUpSequence` + `FollowUpStep` in `prisma/schema.prisma`:
    - `FollowUpStep.messageTemplate` + `FollowUpStep.subject` + `FollowUpStep.condition` (JSON stored as text)
  - Repo scripts run via `tsx` (see `package.json` + `scripts/migrate-appointments.ts`), not `ts-node`.
- What the plan assumes:
  - We will extend step scheduling beyond whole-day offsets to support minute-level delays (2 minutes, 60 minutes).
  - We will intentionally overwrite existing default sequences by name (including edited variants) to standardize copy and timing.
- Verified touch points:
  - `actions/followup-sequence-actions.ts` contains the named functions and `DEFAULT_SEQUENCE_NAMES`.
  - `lib/followup-sequence-linkedin.ts` and `scripts/backfill-linkedin-sequence-steps.ts` both embed LinkedIn message templates that must be updated to avoid drift.
  - `/api/cron/followups` runs every 10 minutes today (`vercel.json`), which is insufficient for “2 minute delay” behavior.

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Timing cannot be met** with a 10-minute cron and day-only offsets → add minute-level offsets to steps + run followups cron every minute.
- **Template drift across duplicates** (`actions/*` vs `lib/*` vs `scripts/*`) → update all sources and add a validation grep/test so old copy can’t linger unnoticed.
- **Migration clobbers in-flight scheduling** (instances/tasks already queued) → migration must also update `FollowUpInstance.nextStepDue` and pending `FollowUpTask.suggestedMessage` so scheduled sends reflect the new copy/timing.

### Missing or ambiguous requirements
- Email subjects: keep existing subjects (explicit requirement).

### Repo mismatches (fix the plan)
- Migration script runner should use `tsx` (repo standard), and follow the `scripts/migrate-appointments.ts` pattern (`dotenv` + `DIRECT_URL` preferred + `PrismaClient`), not `ts-node`.
- LinkedIn templates also exist outside `actions/followup-sequence-actions.ts` (`lib/` + `scripts/`) and must be updated for consistency.

### Performance / timeouts
- Migration across many clients should avoid per-step serial updates with no backpressure → add paging and transaction timeouts; log counts, not full template bodies.

### Security / permissions
- Production migration requires correct DB env (`DIRECT_URL` preferred for CLI) and must avoid logging secrets; store rollback artifacts locally (gitignored) or in a secure location.

### Testing / validation
- Add explicit validation steps:
  - `rg` for old copy to ensure it’s fully replaced
  - DB query to verify updated templates per sequence
  - `npm run lint` + `npm run build`

## Open Questions (Need Human Input)

- (No open questions remaining for Phase 59 based on the latest provided copy + decisions.)

## Assumptions (Agent)

- `{calendarLink}` in follow-up templates should continue to work with Phase 58’s calendar-link separation (confidence ~90%).
  - Mitigation check: verify the follow-up send path uses the same booking-link resolver as compose/AI drafts after Phase 58.
- Canonical messaging copy must be taken verbatim from `Follow-Up Sequencing.md` (confidence ~95%).
  - Mitigation check: if `Follow-Up Sequencing.md` changes, re-run Phase 59e/59f template extraction/migration using the updated text.

## Canonical Copy Source (Single Source of Truth)

- Canonical copy for follow-up sequencing is stored in `Follow-Up Sequencing.md` (repo root).
- Phase 59 execution must:
  - copy message bodies verbatim from `Follow-Up Sequencing.md`
  - keep existing email subjects (do not change `FollowUpStep.subject` during migration)
  - implement placeholder aliasing so the templates can remain verbatim while still rendering correctly (see Phase 59g)

## Phase Summary

- Shipped:
  - Added minute-level step timing via `FollowUpStep.minuteOffset` and cron cadence changes in `vercel.json`.
  - Added `lib/followup-schedule.ts` and updated follow-up + reactivation scheduling to treat `dayOffset` as day-number (Day 1 = 0 days) and honor minute offsets.
  - Updated default sequences + LinkedIn template duplication to match `Follow-Up Sequencing.md` bodies verbatim while keeping existing subjects.
  - Implemented placeholder aliasing + two-slot placeholders in `lib/followup-engine.ts`.
  - Finalized `scripts/migrate-default-sequence-messaging.ts` with overwrite + in-flight remap + rollback support.
- Verified (2026-01-27):
  - `npm run lint`: ✅ (warnings only)
  - `npm run build`: ✅
  - `npm run db:push`: ✅ (“already in sync”)
  - `npm test`: ✅
  - `npx tsx scripts/migrate-default-sequence-messaging.ts`: ✅ dry-run (Sequences processed: 132; would update instances: 546; tasks: 160)
- Notes:
  - Production rollout requires running the migration with `--apply` (canary first via `--clientId <uuid>`). Rollback is supported via the emitted artifact file.
  - Canonical copy source of truth remains `Follow-Up Sequencing.md`.
