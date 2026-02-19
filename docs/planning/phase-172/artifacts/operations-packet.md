# Phase 172 Operations Packet (Scheduler Fairness + Autoscale + Promotion)

## Scope
This packet defines the minimum observability, alerting, and operator procedures required to run `phase-172` staging canaries and support production rollback.

## Emitted Decision Contracts (Current Runtime)

### Autoscale decision payload (`[Background Autoscale]`)
- `timestamp`
- `fromCapacity`
- `toCapacity`
- `reasonCode` (`operator_override` | `guardrail_step_down` | `ramp_step` | `hold_target_reached` | `hold_ramp_window`)
- `guardrailState`
- `operatorOverrideActive`
- `correlationId`
- `globalTarget`

### Promotion-gate decision payload (`[Background Promotion Gate]`)
- `timestamp`
- `promotionGranted`
- `reasonCode` (`feature_disabled`, `healthy_window_recorded`, `gate_open`, `demotion_*`, etc.)
- `healthyWindows`
- `demotionBreachWindows`
- `requiredWindows`
- `signals`:
  - `queueAgeP95Seconds`
  - `failureRatePercent`
  - `contentionBreached`
  - `duplicateSendCount`

### Backpressure payload (`[Background Backpressure]`)
- `deferredJobs`
- `blockedCycles`
- `reasonCode` (`quota_or_capacity_exhausted`)
- `correlationId`

## Alert-to-Action Map

### A1: `guardrail_step_down` frequency spike
- Trigger:
  - `reasonCode=guardrail_step_down` appears in consecutive runs for >= 2 evaluation windows.
- Primary action:
  1. Pin capacity with `BACKGROUND_JOB_AUTOSCALE_OVERRIDE_CAPACITY=<safe value>`.
  2. Enable forced contention/failure signals only in staging for diagnosis (`BACKGROUND_JOB_AUTOSCALE_FORCE_*`).
  3. Inspect recent `BackgroundFunctionRun.lastError`.
- Rollback path:
  - Disable autoscale experiment toggles and revert to baseline worker concurrency.

### A2: Backpressure sustained (`deferredJobs > 0` for multiple runs)
- Trigger:
  - `deferredJobs > 0` across consecutive scheduler cycles.
- Primary action:
  1. Increase partition pool cap if too restrictive (`BACKGROUND_JOB_PARTITION_PER_WORKSPACE_CAP`).
  2. Validate fair queue ordering and per-workspace quota defaults.
  3. Confirm no stale lock buildup via background maintenance stats.
- Rollback path:
  - Reduce load by pinning capacity and temporarily disabling promotion gate.

### A3: Promotion gate closes due to demotion (`demotion_gate_closed`)
- Trigger:
  - Promotion decision reason `demotion_gate_closed`.
- Primary action:
  1. Keep high-quota promotion disabled while breach source is triaged.
  2. Review failure-rate and contention signals for the last demotion windows.
  3. Validate duplicate-send signal source in `BackgroundFunctionRun`.
- Rollback path:
  - Force baseline quota behavior (`BACKGROUND_JOB_HIGH_QUOTA_PROMOTION_ENABLED=0`).

### A4: Immediate duplicate-send demotion (`duplicate_send_immediate_demotion`)
- Trigger:
  - Promotion decision reason `duplicate_send_immediate_demotion`.
- Primary action:
  1. Stop high-quota promotion immediately.
  2. Investigate dedupe/idempotency breach indicators in webhook + send paths.
  3. Escalate to engineering Slack with correlation IDs.
- Rollback path:
  - Keep promotion disabled and pin autoscale while dedupe invariants are validated.

## Operator Controls

### Capacity / autoscale
- `BACKGROUND_JOB_AUTOSCALE_GLOBAL_FLOOR`
- `BACKGROUND_JOB_AUTOSCALE_WORKSPACE_MULTIPLIER`
- `BACKGROUND_JOB_AUTOSCALE_RAMP_STEP`
- `BACKGROUND_JOB_AUTOSCALE_RAMP_WINDOW_MINUTES`
- `BACKGROUND_JOB_AUTOSCALE_STEP_DOWN_FACTOR`
- `BACKGROUND_JOB_AUTOSCALE_OVERRIDE_CAPACITY`

### Promotion / demotion
- `BACKGROUND_JOB_HIGH_QUOTA_PROMOTION_ENABLED`
- `BACKGROUND_JOB_HIGH_QUOTA_PROMOTION_REQUIRED_WINDOWS`
- `BACKGROUND_JOB_HIGH_QUOTA_PROMOTION_WINDOW_MINUTES`
- `BACKGROUND_JOB_HIGH_QUOTA_PROMOTION_QUEUE_AGE_P95_MAX_SECONDS`
- `BACKGROUND_JOB_HIGH_QUOTA_PROMOTION_FAILURE_RATE_MAX_PERCENT`
- `BACKGROUND_JOB_HIGH_QUOTA_DEMOTION_REQUIRED_WINDOWS`
- `BACKGROUND_JOB_HIGH_QUOTA_DEMOTION_WINDOW_MINUTES`
- `BACKGROUND_JOB_HIGH_QUOTA_DEMOTION_FAILURE_RATE_MIN_PERCENT`
- `BACKGROUND_JOB_HIGH_QUOTA_PROMOTION_DUPLICATE_SEND_MAX_COUNT`
- `BACKGROUND_JOB_OBS_DUPLICATE_SEND_COUNT` (manual override/fallback control input)

### Partition / fairness
- `BACKGROUND_JOB_PARTITION_PER_WORKSPACE_CAP`
- `BACKGROUND_JOB_WORKSPACE_QUOTA_DEFAULT`
- `BACKGROUND_JOB_WORKSPACE_QUOTA_ENTERPRISE`
- `BACKGROUND_JOB_ENTERPRISE_CLIENT_IDS` (deprecated fallback only)

## Staging Canary Checklist (`172f`)

1. Baseline capture (30-60 min):
   - Collect autoscale/promotion/backpressure logs with default controls.
2. Hot-tenant simulation:
   - Induce one workspace burst load and confirm other tenants still execute.
3. Guardrail simulation:
   - In staging only, force contention/failure signals and verify deterministic step-down.
4. Promotion window simulation:
   - Enable promotion gate and validate healthy window accumulation + gate open/close behavior.
5. Duplicate-signal simulation:
   - Set `BACKGROUND_JOB_OBS_DUPLICATE_SEND_COUNT=1` and verify immediate demotion path.
6. Recovery pass:
   - Clear forced signals and confirm system returns to healthy `hold/ramp` states.

## Go / No-Go Criteria

Go when all are true:
- No duplicate-send invariant breaches.
- Backpressure does not remain sustained under mixed-load staging scenarios.
- Autoscale and promotion decisions are explainable with reason-code traces.
- Validation gates remain green (`lint`, `build`, `test`).

No-go when any are true:
- Duplicate-send demotion triggers without a clear mitigation.
- Repeated uncontrolled step-down loops under nominal load.
- Starvation evidence for low-volume tenants during hot-tenant bursts.

## Evidence Recording Template

For each canary run, capture:
- Run window start/end (UTC)
- Config diff from baseline
- Log excerpts for autoscale/promotion/backpressure decisions
- Alert triggered (if any) + operator action taken
- Result (`pass` | `fail`) + next action
