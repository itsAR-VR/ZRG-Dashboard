# Phase 59d — Precise Timing Support (Minute Offsets) + Cron Cadence

## Focus
Add minute-level timing support to follow-up sequencing so we can honor the Day 1 requirements:

- SMS: **2 minutes** after the Day 1 email
- LinkedIn connect: **1 hour** after the Day 1 email

This also requires increasing follow-ups cron cadence to run at least every minute.

## Inputs
- Existing follow-up scheduling code:
  - `lib/followup-engine.ts` (cron processing + nextStepDue calculation)
  - `lib/followup-automation.ts` (auto-start + schedule reset on outbound)
  - `actions/followup-sequence-actions.ts` (types + default sequence creation)
- Data model:
  - `prisma/schema.prisma` (`FollowUpStep.dayOffset`, `FollowUpInstance.nextStepDue`)
- Cron configuration:
  - `vercel.json` (`/api/cron/followups` currently `*/10 * * * *`)

## Work

### 1) Add a minute-offset field to FollowUpStep (schema + types)
- Add `minuteOffset Int @default(0)` to `FollowUpStep` in `prisma/schema.prisma`.
  - Semantics: additional minutes after the `(dayOffset)` boundary for the sequence, relative to `FollowUpInstance.startedAt`.
  - Examples:
    - Day 1 email: `dayOffset=1`, `minuteOffset=0`
    - Day 1 SMS: `dayOffset=1`, `minuteOffset=2`
    - Day 1 LinkedIn: `dayOffset=1`, `minuteOffset=60`
- Update `FollowUpStepData` in `actions/followup-sequence-actions.ts` to include `minuteOffset`.
- Update all create/read/update paths to persist and return `minuteOffset`.

### 2) Scheduling math: compute and use a unified “step offset”
- Introduce a small helper (shared or duplicated as needed) that computes a step’s total offset from `startedAt`:
  - `offsetMs = dayOffset * 24h + minuteOffset * 60s`
- Update all places that compute `nextStepDue` to incorporate minute offsets:
  - `lib/followup-automation.ts`
    - `startSequenceInstance()` (first step due)
    - `autoStartNoResponseSequenceOnOutbound()` (first step due uses `outboundAt` + offsets)
    - `resetActiveFollowUpInstanceScheduleOnOutboundTouch()` (spacing between steps)
    - resume-on-outbound path (pausedReplied) spacing between steps
  - `lib/followup-engine.ts`
    - When advancing from a step to the next-next step: use `(nextNext.offsetMs - current.offsetMs)` (not just dayDiff)
    - Same for “advance past permanently skipped steps”
- Add clamping rules:
  - If computed delta is negative (should not happen if step ordering is correct), clamp to `0` and log a warning.

### 3) Ordering: ensure stepOrder matches (dayOffset, minuteOffset, channel)
- Update `sortStepsForScheduling()` to sort by:
  1) `dayOffset` asc
  2) `minuteOffset` asc
  3) channel priority (email → sms → linkedin → ai_voice)
- Apply this sorting in:
  - default-sequence construction (`actions/followup-sequence-actions.ts`)
  - LinkedIn backfill helpers (`lib/followup-sequence-linkedin.ts`, `scripts/backfill-linkedin-sequence-steps.ts`)

### 4) Cron cadence update
- Update `vercel.json` to run follow-ups cron every minute:
  - Change `/api/cron/followups` schedule from `*/10 * * * *` → `* * * * *`
- RED TEAM: rate limiting + provider quotas
  - Confirm `canSendFollowUp()` and per-channel limits prevent “tight loops” if a step is repeatedly due and fails.

## Validation (RED TEAM)
- `npm run lint`
- `npm run build`
- Unit tests (recommended if lightweight):
  - A pure-function unit test for the offset/delta math and sorting order (minute offsets in the same day).
- Manual sanity (staging):
  - Create a test default sequence with day 1 steps (0, +2m, +60m) and confirm `nextStepDue` updates as expected after each send.

## Output

### Completed
- [x] Added `minuteOffset Int @default(0)` to `FollowUpStep` in `prisma/schema.prisma`
- [x] Updated `FollowUpStepData` interface in `actions/followup-sequence-actions.ts` to include `minuteOffset`
- [x] Updated all step creation/read/update paths to persist and return `minuteOffset`
- [x] Updated `sortStepsForScheduling()` to sort by `(dayOffset, minuteOffset, channel)`
- [x] Added timing helpers `computeStepOffsetMs()` and `computeStepDeltaMs()` to:
  - `lib/followup-engine.ts`
  - `lib/followup-automation.ts`
- [x] Updated all `nextStepDue` calculations to use `computeStepDeltaMs()` instead of `dayDiff * 24 * 60 * 60 * 1000`
- [x] Updated `lib/followup-sequence-linkedin.ts` sorting to include `minuteOffset`
- [x] Changed `/api/cron/followups` cadence from `*/10 * * * *` → `* * * * *` in `vercel.json`
- [x] `npm run db:push` succeeded
- [x] `npm run lint` passes (0 errors)
- [x] `npm run build` passes

### Files Modified
- `prisma/schema.prisma` — Added `minuteOffset` field to `FollowUpStep`
- `actions/followup-sequence-actions.ts` — Types, sorting, step creation/mapping
- `lib/followup-engine.ts` — Timing helpers, `nextStepDue` calculations
- `lib/followup-automation.ts` — Timing helpers, `nextStepDue` calculations
- `lib/followup-sequence-linkedin.ts` — Type and sorting updates
- `vercel.json` — Cron cadence update

## Handoff
Phase 59e will set the canonical copy + minute offsets on the default sequences. Phase 59f will migrate production data (sequences, in-flight instances, pending tasks) safely.

