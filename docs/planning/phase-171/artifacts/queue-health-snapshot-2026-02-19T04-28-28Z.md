# Queue Health Snapshot — 2026-02-19T04:28:28Z

## Source
- Production deploy completed at `https://zrg-dashboard.vercel.app`.
- Authenticated cron canary request executed on `/api/cron/background-jobs`.
- Operator SQL checks executed directly against Supabase production.

## Canary Response (live)
- HTTP status: `200`
- Mode: `inline-stale-run-recovery`
- `staleRecovery.functionName`: `process-background-jobs`
- `staleRecovery.staleMinutes`: `15`
- `staleRecovery.recovered`: `11`
- `staleRecovery.oldestStartedAt`: `2026-02-18T05:50:56.637Z`
- `queueHealth.stale`: `false`
- `functionRunHealth.stale`: `false`

## Operator Metrics (post-recovery)
- Due queue depth (`BackgroundJob` pending due now): `0`
- `process-background-jobs` running count: `0`
- Stale runs over 15 minutes: `0`
- Dispatch outcomes over last 60m (`BackgroundDispatchWindow`):
  - `ENQUEUED`: `60`
  - `ENQUEUE_FAILED`: `0`
  - `INLINE_EMERGENCY`: `0`

## Duplicate-Send Guard Check (last 60m)
- `ghlId`: `duplicate_groups=0`, `duplicate_rows=0`
- `emailBisonReplyId`: `duplicate_groups=0`, `duplicate_rows=0`
- `inboxxiaScheduledEmailId`: `duplicate_groups=0`, `duplicate_rows=0`
- `unipileMessageId`: `duplicate_groups=0`, `duplicate_rows=0`
- `webhookDedupeKey`: `duplicate_groups=0`, `duplicate_rows=0`

## Interpretation
- The stale function-run cluster that was blocking global liveness was cleared automatically by the new watchdog path.
- Queue due depth remained at zero during and after recovery.
- Dispatch remained healthy with no enqueue failures.
- No duplicate-send indicators were observed during this canary window.
