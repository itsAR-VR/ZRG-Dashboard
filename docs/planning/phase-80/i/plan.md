# Phase 80i — Hardening: Holidays + Hybrid TZ + Booking Completion Alignment

## Focus

Implement the remaining decision-locked requirements:
- Hybrid timezone resolution (lead TZ fallback to workspace TZ)
- Custom schedule holiday preset + overrides
- Complete follow-ups on booking (not pause)

## Inputs

- Phase 80g schedule primitives (`lib/auto-send-schedule.ts`)
- Auto-send orchestration + delayed job runner
- Settings UI + server actions
- Booking follow-up pause helper in `lib/followup-engine.ts`

## Work

1. Extend `lib/auto-send-schedule.ts`:
   - Add holiday config support (US Federal + common preset + overrides).
   - Implement hybrid timezone resolution (lead TZ → workspace TZ → fallback).
   - Ensure `isWithinAutoSendSchedule()` and `getNextAutoSendWindow()` honor blackouts.

2. Wire hybrid TZ into auto-send:
   - Add `leadTimezone` to `AutoSendContext`.
   - Pass lead timezone in all `executeAutoSend()` call sites.
   - Update schedule resolution calls to include lead timezone.

3. Update settings & actions:
   - Add holiday fields to schedule payloads (workspace + campaign).
   - Validate schedule JSON server-side.
   - Admin-only gating for schedule updates.

4. UI:
   - Workspace schedule editor supports holiday preset + overrides.
   - Campaign overrides allow additional blackout dates/ranges (additive).

5. Booking follow-ups:
   - Switch booking handling to **complete** sequences.
   - Remove/avoid resume on cancellation.

6. Tests:
   - Add schedule tests (weekday/weekend, overnight, holiday blackout).
   - Add orchestrator tests for outside-window rescheduling.

## Output

- Extended `lib/auto-send-schedule.ts` with holiday presets + blackout overrides and hybrid timezone resolution; schedule checks skip blackout dates.
- Admin-gated + validated schedule updates in `actions/settings-actions.ts` and `actions/email-campaign-actions.ts` via `validateAutoSendCustomSchedule`.
- UI updates:
  - Workspace schedule editor supports holiday preset, excluded dates, and additional blackout dates/ranges (`components/dashboard/settings-view.tsx`).
  - Campaign schedule overrides allow additive blackout dates/ranges (`components/dashboard/settings/ai-campaign-assignment.tsx`).
- Booking completion alignment: booking actions + Calendly reconcile now call `pauseFollowUpsOnBooking(..., { mode: "complete" })`; removed resume-on-cancel call in reconcile.
- Added lead timezone to auto-send backfill context (`scripts/backfill-ai-auto-send.ts`).
- Tests updated: `lib/auto-send/__tests__/auto-send-schedule.test.ts` (holiday + lead TZ), orchestrator tests updated for `scheduleAutoSendAt`.

## Coordination Notes

**Overlap with Phase 81:** `components/dashboard/settings-view.tsx` (Slack + settings UI). Changes merged with existing edits without conflict.

## Handoff

- Run `npm run lint` / `npm run build` if needed; verify UI schedule editor flows.
- Consider removing `resumeFollowUpsOnBookingCanceled()` if it’s now permanently unused.
