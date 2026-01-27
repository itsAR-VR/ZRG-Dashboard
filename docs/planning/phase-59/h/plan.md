# Phase 59h — Production Readiness (Canonical Copy + Scheduling + Migration)

## Focus
Close the remaining Phase 59 gaps so default follow-up sequencing is production-ready:

- Templates match `Follow-Up Sequencing.md` (verbatim bodies) while keeping existing email subjects
- Day 1 uses `dayOffset=1` with minute-level timing (SMS +2m, LinkedIn +60m)
- Renderer supports canonical placeholders (`{FIRST_NAME}`, `{link}`, `{time 1 day 1}`, etc.)
- Migration script overwrites default sequences and updates in-flight instances/tasks safely with rollback

## Inputs
- Canonical copy: `Follow-Up Sequencing.md`
- Current implementation + gaps: `docs/planning/phase-59/review.md`
- Files to update:
  - `actions/followup-sequence-actions.ts`
  - `lib/followup-engine.ts`
  - `lib/followup-automation.ts`
  - `lib/followup-sequence-linkedin.ts`
  - `scripts/backfill-linkedin-sequence-steps.ts`
  - `scripts/migrate-default-sequence-messaging.ts`

## Work

### 1) Remove non-Phase-59 noise
- Ensure Phase 60 UI changes are not bundled into this rollout.

### 2) Fix scheduling semantics
- Treat `dayOffset` as **day-number** (Day 1 = offset 0 days, Day 2 = +1 day, etc.), while remaining backward compatible with `dayOffset=0`.
- Ensure all schedule calculations (start/resume/advance) respect `minuteOffset`.

### 3) Apply canonical messaging everywhere (keep subjects)
- Update default templates in `actions/` + LinkedIn duplication in `lib/` + `scripts/`.
- Keep existing email subjects unchanged (e.g., “Scheduling a quick call”, “Re: Scheduling a quick call”, “Quick question”, “Re: Quick question”, “You’re booked in!”).

### 4) Implement placeholder aliasing + slot placeholders
- Support doc placeholders:
  - `{FIRST_NAME}`, `{{contact.first_name}}`
  - `{name}`, `{company}`, `{link}`
  - `{achieving result}`
  - `{qualification question 1}`, `{qualification question 2}`
  - `{time 1 day 1}`, `{time 2 day 2}`, `{x day x time}`, `{y day y time}`
- Ensure slot placeholders render from the first 1–2 availability slots.

### 5) Finalize migration script (dry-run → apply)
- Overwrite default sequences by name with canonical steps/timing.
- Update in-flight `FollowUpInstance.currentStep` / `nextStepDue` mappings and pending `FollowUpTask` suggestedMessage/subject.
- Write a rollback artifact to disk and support `--rollback`.
- Validate with canary support: `--clientId <uuid>`.

## Output
- Scheduling semantics + minute offsets:
  - Added `lib/followup-schedule.ts` (day-number `dayOffset` + `minuteOffset` helpers).
  - Updated schedule calculations to use the shared helpers:
    - `lib/followup-engine.ts` (step-to-step deltas)
    - `lib/followup-automation.ts` (auto-start + reset scheduling)
    - `actions/followup-sequence-actions.ts` (start/advance/resume)
    - `lib/reactivation-engine.ts` (reactivation follow-up instance start)
- Canonical templates (subjects preserved):
  - Updated defaults to match `Follow-Up Sequencing.md` bodies verbatim in `actions/followup-sequence-actions.ts`.
  - Updated LinkedIn template duplication in `lib/followup-sequence-linkedin.ts` and `scripts/backfill-linkedin-sequence-steps.ts`.
- Placeholder aliasing + slot placeholders:
  - Updated `lib/followup-engine.ts:generateFollowUpMessage()` to support canonical placeholders (`{FIRST_NAME}`, `{link}`, `{{contact.first_name}}`, `{time 1 day 1}`, etc.).
- Migration script (production-ready):
  - Updated `scripts/migrate-default-sequence-messaging.ts` to:
    - overwrite default sequences by name with canonical steps/timing
    - preserve existing subjects
    - remap in-flight instance/task step orders and recompute `nextStepDue`
    - support `--rollback` via a rollback artifact
  - Verified DB connectivity + dry-run:
    - `npx tsx scripts/migrate-default-sequence-messaging.ts` processed 132 sequences (dry-run) and reported would update 546 instances / 160 tasks.
- Verification:
  - `npm run lint` ✅ (warnings only)
  - `npm run build` ✅
  - `npm run db:push` ✅
  - `npm test` ✅

## Handoff
- Phase wrap-up:
  - Update `docs/planning/phase-59/plan.md` success criteria + Phase Summary.
  - Update `docs/planning/phase-59/review.md` with final evidence + rollout runbook for `--apply` + rollback.
