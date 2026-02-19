# Phase 171b — Must-Have Fix: Stale Run Recovery

## Focus
Ensure one stuck `process-background-jobs` run cannot hold the system hostage.

## Inputs
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-171/a/plan.md`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/inngest/functions/process-background-jobs.ts`
`/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/runner.ts`

## Work
1. Add stale-run detection for `process-background-jobs` runs past threshold.
verify: stale run transitions out of `RUNNING` in controlled way.
2. Add safe recovery path to resume queue processing.
verify: pending jobs continue progressing after stale run recovery.
3. Guard against duplicate side effects during recovery.
verify: duplicate-send invariant remains true in replayed recovery case.

## Output
Minimal liveness fix merged behind rollout control.

## Handoff
Phase 171c adds bounded parallel drain after stale-run recovery is stable.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added stale function-run recovery helper in `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/dispatch-ledger.ts`:
    - `recoverStaleBackgroundFunctionRuns()`
    - env controls: `BACKGROUND_FUNCTION_RUN_STALE_MINUTES`, `BACKGROUND_FUNCTION_RUN_STALE_RECOVERY_LIMIT`
  - Wired cron watchdog in `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/app/api/cron/background-jobs/route.ts`:
    - stale-run detection before dispatch
    - inline recovery mode `inline-stale-run-recovery` when stale runs are found and fallback is enabled
    - new toggle: `BACKGROUND_JOBS_INLINE_ON_STALE_RUN` (defaults enabled when unset)
- Commands run:
  - `npm run lint` — pass (warnings only, unrelated to touched files)
  - `npm run build` — pass
- Blockers:
  - None for code implementation.
- Next concrete steps:
  - Run canary with stale-run simulation and confirm queue resumes under the watchdog path.
