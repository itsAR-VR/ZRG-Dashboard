# Phase 171 Queue Stall Runbook

## Trigger Conditions
- `process-background-jobs` has stale `RUNNING` rows (older than `BACKGROUND_FUNCTION_RUN_STALE_MINUTES`, default 15m).
- Oldest due `BackgroundJob` age breaches queue SLO.

## Immediate Checks
1. Run `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-171/artifacts/queue-health-operator-queries.sql`.
2. Verify cron dispatch is active and not auth-failing (`/api/cron/background-jobs` with `CRON_SECRET`).
3. Confirm `BackgroundDispatchWindow` outcomes over the last hour show mostly `ENQUEUED`.

## Operational Recovery Actions
1. Confirm stale run watchdog is enabled:
`BACKGROUND_JOBS_INLINE_ON_STALE_RUN=true` (or unset, defaults enabled).
2. Confirm stale threshold controls:
`BACKGROUND_FUNCTION_RUN_STALE_MINUTES=15`
`BACKGROUND_FUNCTION_RUN_STALE_RECOVERY_LIMIT=25`
3. If backlog grows while stale runs persist:
- temporarily raise `BACKGROUND_JOB_WORKER_CONCURRENCY` (max 8) in controlled steps.
- temporarily raise `BACKGROUND_JOBS_INNGEST_CONCURRENCY` (max 8) in controlled steps.

## Rollback Path
If queue behavior regresses after concurrency tuning:
1. Set `BACKGROUND_JOB_WORKER_CONCURRENCY=1`.
2. Set `BACKGROUND_JOBS_INNGEST_CONCURRENCY=1`.
3. Keep stale-run recovery enabled.
4. Re-evaluate queue metrics after one dispatch window (>= 5 minutes).
