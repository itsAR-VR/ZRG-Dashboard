-- Phase 171 operator query pack
-- Purpose: classify queue-stall risk and canary health quickly.

-- 1) Due queue depth + oldest due age
SELECT
  now() AS ts_utc,
  COUNT(*) FILTER (WHERE status = 'PENDING' AND "runAt" <= now()) AS pending_due,
  MIN("runAt") FILTER (WHERE status = 'PENDING' AND "runAt" <= now()) AS oldest_due_run_at
FROM "BackgroundJob";

-- 2) process-background-jobs run health
SELECT
  now() AS ts_utc,
  COUNT(*) FILTER (WHERE "functionName" = 'process-background-jobs' AND status = 'RUNNING') AS running_count,
  MIN("startedAt") FILTER (WHERE "functionName" = 'process-background-jobs' AND status = 'RUNNING') AS oldest_running_started_at,
  COUNT(*) FILTER (
    WHERE "functionName" = 'process-background-jobs'
      AND status = 'RUNNING'
      AND "startedAt" < now() - interval '15 minutes'
  ) AS stale_over_15m
FROM "BackgroundFunctionRun";

-- 3) recent dispatch outcomes (last hour)
SELECT
  now() AS ts_utc,
  COUNT(*) FILTER (WHERE status = 'ENQUEUED') AS enqueued,
  COUNT(*) FILTER (WHERE status = 'ENQUEUE_FAILED') AS enqueue_failed,
  COUNT(*) FILTER (WHERE status = 'INLINE_EMERGENCY') AS inline_emergency
FROM "BackgroundDispatchWindow"
WHERE "requestedAt" >= now() - interval '60 minutes';
