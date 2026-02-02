# Phase 80g — Hardening: Schedule Window + Delay Semantics

## Focus

Make schedule enforcement precise and consistent across immediate sends and delayed sends, including rescheduling delayed jobs when they fire outside the allowed window (settings changed, DST, etc.).

This subphase exists to address RED TEAM gaps where a naive schedule integration can still send outside configured windows or interact poorly with the existing delay-window logic.

## Inputs

- Phase 80b/c complete (schema + `lib/auto-send-schedule.ts`)
- Auto-send execution:
  - `lib/auto-send/orchestrator.ts`
  - `lib/auto-send/types.ts` (context fields for schedule config)
- Background jobs:
  - `lib/background-jobs/delayed-auto-send.ts` (scheduling + validation)
  - `lib/background-jobs/ai-auto-send-delayed.ts` (delayed execution)
  - `lib/background-jobs/runner.ts` (reschedule handling)
- Open Questions in `docs/planning/phase-80/plan.md` (timezone + jitter decisions)

## Work

1. **Decide schedule semantics (lock decisions):**
   - Confirm whether schedule enforcement uses workspace timezone vs lead timezone.
   - Confirm whether “outside schedule” schedules exactly at next window start or preserves campaign delay jitter.

2. **Define the canonical “effective send time” algorithm:**
   - For delayed sends: compute a candidate runAt (delay window), then enforce schedule for that candidate time.
   - For immediate sends: if outside schedule, do not send; schedule a delayed send to the next valid window.

3. **Ensure we can schedule at a fixed `runAt`:**
   - Add/confirm a helper in `lib/background-jobs/delayed-auto-send.ts` for fixed-time scheduling (used for “next window”).
   - Ensure the dedupe story is correct (don’t create duplicate delayed jobs when re-evaluated).

4. **Reschedule delayed jobs at execution time (not skip):**
   - In `lib/background-jobs/ai-auto-send-delayed.ts`, re-check schedule before sending.
   - If outside schedule, reschedule to the next window (do not mark the job “done”).
   - Ensure `lib/background-jobs/runner.ts` cleanly handles the reschedule signal (sets `runAt` to the requested time).

5. **Telemetry & debuggability:**
   - Record a structured reason string for schedule-based delays (e.g., `outside_schedule:day_not_active`).
   - Ensure logs include the computed next window and schedule mode.

6. **Validation (RED TEAM):**
   - Unit test `lib/auto-send-schedule.ts` for:
     - BUSINESS_HOURS weekday/weekend
     - overnight windows (start > end)
     - DST boundary (best-effort)
   - Orchestrator tests:
     - within schedule → immediate/normal delay behavior
     - outside schedule → delayed to next window

## Output

- Schedule enforcement is applied consistently for immediate and delayed sends.
- Delayed job execution reschedules (not skips) when outside schedule.
- Tests exist and pass for core schedule behavior.

## Handoff

Proceed to Phase 80h to finish centralizing “pause follow-ups on booking” across *all* booking sources/call sites.
