# Durable Health Snapshot — response-timing
- CapturedAtUTC: 2026-02-18T03-28-49Z
- DataSource: Prisma query against production DB connection values from `/tmp/phase169-prod.env`
- SnapshotFile: durable-health-response-timing-2026-02-18T03-28-49Z.json
- Scope:
  - `BackgroundFunctionRun` for `cron-response-timing` (latest runs + 6h status counts)
  - `BackgroundFunctionRun` for all `cron-*` functions (6h status counts)
  - `WebhookEvent` queue depth (`PENDING` due/future, `RUNNING`, `FAILED` last 24h)

## Result
- `BackgroundFunctionRun`: no rows present for `cron-response-timing` in the sampled window.
- `WebhookEvent`: no queued rows in sampled snapshot (`pending/running/failed` all `0`).
- Interpretation: durable-run ledger evidence is currently missing for this migrated route and remains a verification blocker.
