# Queue Health Snapshot — 2026-02-19T03:50:06Z

## Source
Supabase SQL checks executed directly against current environment.

## Results
- Due queue depth (`BackgroundJob` pending due now): `0`
- `process-background-jobs` running count: `11`
- Oldest running started at: `2026-02-18 05:50:56.637`
- Stale runs over 15 minutes: `10`
- Dispatch outcomes over last 60m (`BackgroundDispatchWindow`):
  - `ENQUEUED`: `60`
  - `ENQUEUE_FAILED`: `0`
  - `INLINE_EMERGENCY`: `0`

## Interpretation
- Dispatch continues to enqueue successfully.
- A stale-run cluster still exists and validates the need for the new stale-run watchdog and recovery fence.
- Queue due depth was zero at snapshot time, so throughput/backlog pressure was not active in this instant.
