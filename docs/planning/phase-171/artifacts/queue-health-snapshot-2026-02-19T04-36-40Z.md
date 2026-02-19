# Queue Health Snapshot — 2026-02-19T04:36:40Z

## Source
- Production redeploy completed at `https://zrg-dashboard.vercel.app`.
- Authenticated cron check executed on `/api/cron/background-jobs` after redeploy.
- Supabase operator SQL checks executed immediately after cron response.

## Cron Endpoint Check (post-redeploy)
- HTTP status: `202`
- Mode: `dispatch-only`
- `enqueued`: `true`
- `staleRecovery.recovered`: `0`
- `dispatchKey`: `background-jobs:v1:60:2026-02-19T04:36:00.000Z`

## Operator Metrics
- Due queue depth (`BackgroundJob` pending due now): `0`
- Stale running background jobs (`BackgroundJob` lock older than 15m): `0`
- `process-background-jobs` running count: `1` (active run, non-stale)
- `process-background-jobs` stale over 15m: `0`
- Dispatch outcomes over last 60m:
  - `ENQUEUED`: `60`
  - `ENQUEUE_FAILED`: `0`
  - `INLINE_EMERGENCY`: `0`

## Interpretation
- Post-redeploy health remains stable.
- No stale run regression observed.
- Dispatch cadence and enqueue success remain healthy.
