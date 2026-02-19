# Phase 172 Staging Canary Evidence (2026-02-19)

## Run Window
- Start (UTC): `2026-02-19T08:00:08Z`
- End (UTC): `2026-02-19T08:04:10Z`

## Data Sources
- Live staging database telemetry via Supabase SQL (`BackgroundFunctionRun`, `BackgroundDispatchWindow`, `BackgroundJob`, `WorkspaceSettings`).
- Live authenticated cron probes via Playwright against `GET /api/cron/background-jobs` (Bearer `CRON_SECRET` header).
- Deterministic control-loop simulation using current code:
  - `lib/background-jobs/autoscale-control.ts`
  - `lib/background-jobs/promotion-gate.ts`
  - Artifact: `docs/planning/phase-172/artifacts/staging-canary-simulations-2026-02-19.json`

## Environment Constraint (Observed)
- Shell DNS for direct Vercel/API calls was unavailable in this run context (`ENOTFOUND api.vercel.com`, `ENOTFOUND zrg-dashboard.vercel.app`).
- Mitigation applied: Playwright network path successfully executed authenticated cron probes; runtime log-streaming from shell remains unavailable.

## Checklist Evidence

### 1) Baseline capture (stability + cadence)
- Authenticated cron probes (Playwright):
  - `2026-02-19T08:06:48Z` — HTTP `200`, `mode=dispatch-duplicate-suppressed`, `enqueued=false`
  - `2026-02-19T08:07:11Z` — HTTP `200`, `mode=dispatch-duplicate-suppressed`, `dispatchKey=background-jobs:v1:60:2026-02-19T08:07:00.000Z`, `enqueued=false`
- `process-background-jobs` in last 60m:
  - `runs_60m=60`
  - `succeeded_60m=60`
  - `failed_60m=0`
  - `failed_percent_60m=0.000`
- Dispatch windows in last 60m:
  - `dispatch_enqueued_60m=60`
  - `dispatch_non_enqueued_60m=0`
- Run cadence gap sample (last 60m):
  - `avg_gap_seconds=60.09`
  - `max_gap_seconds=74.21`

Result: `pass` (live auth probes + DB cadence agree)

### 2) Hot-tenant fairness evidence (historical load)
- Heavy minute analysis over last 24h (`total_jobs >= 8`):
  - `heavy_minutes_24h=96`
  - `heavy_minutes_multi_client_24h=93`
  - `heavy_minutes_with_headroom_24h=90` (`top_share <= 0.80`)
  - `avg_top_share_multi_client_24h=0.415`
- Representative rows include minutes where one client processed `3-7` jobs while `3-9` clients were active in the same minute.

Result: `pass` (no starvation signal in observed heavy windows)

### 3) Guardrail simulation
- Baseline decision (current contract):
  - `reasonCode=hold_target_reached`
  - `fromCapacity=1024`
  - `toCapacity=1024`
- Forced contention breach simulation:
  - `reasonCode=guardrail_step_down`
  - `fromCapacity=2048`
  - `toCapacity=1024`

Source: `docs/planning/phase-172/artifacts/staging-canary-simulations-2026-02-19.json`

Result: `pass`

### 4) Promotion window simulation
- Runtime config snapshot in this environment:
  - `enabled=false`
  - `requiredWindows=4`
- Forced-enabled simulation (for control-path verification):
  - healthy signal produces `reasonCode=healthy_window_recorded`

Source: `docs/planning/phase-172/artifacts/staging-canary-simulations-2026-02-19.json`

Result: `pass` for control logic; runtime promotion currently disabled

### 5) Duplicate-signal simulation
- Live duplicate-like run errors:
  - `duplicate_signal_runs_24h=0`
- Forced-enabled duplicate simulation:
  - `reasonCode=duplicate_send_immediate_demotion`

Source: `docs/planning/phase-172/artifacts/staging-canary-simulations-2026-02-19.json`

Result: `pass`

### 6) Recovery/backpressure check
- Queue health at capture time:
  - `due_pending_now=0`
  - `queue_age_p95_seconds_now=0.00`
  - `queue_age_max_seconds_now=0.00`
- Last 15 function runs were all `SUCCEEDED` with short durations (14-77ms).

Result: `pass`

## Backfill Resolution (Applied)
- At `2026-02-19T08:25:57Z`, executed backfill:
  - `update "WorkspaceSettings" set "highQuotaEnabled" = true where "highQuotaEnabled" = false`
  - `rows_updated=62`
- Post-backfill distribution:
  - `total_workspaces=62`
  - `high_quota_enabled=62`
  - `high_quota_disabled=0`

## Go/No-Go Assessment
- `GO` for baseline fairness/autoscale scheduler behavior under current runtime configuration.
- `GO` for high-quota tier readiness:
  - `highQuotaEnabled` backfill is now aligned with the phase decision lock.
  - Promotion remains runtime-flag controlled; enable only when rollout window is approved.
