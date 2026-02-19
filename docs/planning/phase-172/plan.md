# Phase 172 — Inngest Fairness + Autoscaling Architecture for 100k Users

## Purpose
Design and implement the next-scale architecture for background processing so the platform can support 100,000 users with higher throughput, tenant fairness, and deterministic recovery behavior, without migrating away from Inngest/Postgres in this phase.

## Context
Phase 171 is stabilization-first (queue stalls, stale-run recovery, bounded drain, strict dedupe). This phase converts that stabilization into durable scale architecture:
- Keep current queue stack (`Inngest + Postgres`) and extend it with scheduler-level fairness and autoscaling controls.
- Use workspace-scaled global capacity with autoscaling guardrails rather than fixed low caps.
- Enforce per-workspace concurrency quotas so large workspaces cannot starve smaller ones.
- Preserve strict no-duplicate customer-visible sends while increasing throughput.
- Provide an explicit path to higher per-workspace quotas for all companies (up to 100 workers/workspace), with enterprise fast-paths behind measurable contention and reliability gates.

Capability baseline from Inngest docs used in this phase:
- function `concurrency` (including keyed scope)
- `throttle`
- `rateLimit`
These are used as building blocks for fairness and global guardrails.

Locked planning decisions:
- Global worker model: workspace-scaled with floor `1024` (all workspaces combined)
  - `globalFloor = 1024`
  - `globalTarget = max(1024, activeWorkspaceCount * 64)`
  - no fixed planning-time upper stop; scale-up is controlled by contention/error guardrails
- Default per-workspace quota: `64` (global default)
- Enterprise tier source-of-truth: `WorkspaceSettings.highQuotaEnabled` (Prisma-backed)
- Existing workspace rollout for tier flag: backfill `highQuotaEnabled=true` for all existing workspaces during cutover
- New workspace default: `highQuotaEnabled=false` so baseline quota starts at `64`
- Initial execution style: chunk + bounded parallelism from Phase 171, then scale via guardrails
- Primary autoscale control layer in 172c: runner-first (`processBackgroundJobs()` control loop)
- Contention policy: staged ramp-up while healthy + automatic step-down when guardrails breach
- Mixed-load evidence target in 172c: staging simulation load (non-production)
- Alert channel for this phase: Slack engineering

## Repo Reality Check (RED TEAM)

- What exists today:
  - `app/api/cron/background-jobs/route.ts` already enforces `CRON_SECRET`, computes dispatch windows, suppresses duplicate dispatches, and supports both dispatch-only and guarded inline fallback modes.
  - `lib/inngest/functions/process-background-jobs.ts` currently has fixed function-level concurrency (`BACKGROUND_JOBS_INNGEST_CONCURRENCY` capped at `8`) and idempotency keyed by `event.data.dispatchKey`.
  - `lib/background-jobs/runner.ts` currently drains due jobs with bounded worker concurrency (`BACKGROUND_JOB_WORKER_CONCURRENCY` capped at `8`) and stale `RUNNING` lock release for `BackgroundJob` rows.
  - Durable dispatch/run models already exist in `prisma/schema.prisma` (`BackgroundDispatchWindow`, `BackgroundFunctionRun`, `BackgroundJob`).
- What this phase now assumes:
  - 172 implementation must build on Phase 171/165 contracts and cannot replace dispatch semantics.
  - fairness/autoscaling controls are additive to the current runner + Inngest function model.
- Verified touch points:
  - `app/api/cron/background-jobs/route.ts`
  - `lib/background-jobs/runner.ts`
  - `lib/background-jobs/dispatch-ledger.ts`
  - `lib/background-jobs/maintenance.ts`
  - `lib/inngest/functions/process-background-jobs.ts`
  - `lib/inngest/events.ts`
  - `prisma/schema.prisma`

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 171 | Active | Same background execution path (`lib/background-jobs/*`, `lib/inngest/*`, `app/api/cron/background-jobs/route.ts`) | Treat 171 lock decisions as hard dependency before 172 shared-file implementation slices. |
| Phase 170 | Active | Observability conventions and perf evidence formatting | Reuse metric names/artifact format to avoid divergent dashboards. |
| Phase 169 | Active | Dispatch semantics, cron offload flags, and idempotency keys | Do not fork event contracts; preserve existing dispatch-key semantics. |
| Phase 165 | Active | Durable dispatch ledger and function-run model | Build on existing `BackgroundDispatchWindow`/`BackgroundFunctionRun` models; avoid schema duplication. |
| Working tree | Active | Uncommitted edits in shared runtime paths (`lib/background-jobs/*`, `lib/inngest/*`, `app/api/cron/background-jobs/route.ts`) | Run pre-flight conflict checks before each implementation slice and re-read file state just-in-time before edits. |

## Objectives
* [x] Ship global + per-workspace scheduler controls that increase throughput while preventing noisy-neighbor starvation.
* [x] Add autoscaling control logic with explicit contention/error guardrails and deterministic scale-up/scale-down behavior.
* [x] Add partitioning/backpressure controls so burst load does not collapse DB/runtime health.
* [x] Define and validate per-workspace quota escalation path (`64 -> 100`) with strict safety gates.
* [x] Produce rollout-ready observability + runbook + canary evidence packet with explicit go/no-go criteria. (staging evidence captured; promotion rollout remains conditional on tier/backfill confirmation)

## Constraints
- No queue-platform migration in this phase (no Kafka/SQS adoption here).
- Preserve existing webhook/cron auth checks (`Authorization: Bearer ${CRON_SECRET}`).
- Preserve strict duplicate-send invariant (zero customer-visible duplicates).
- Keep user-facing inbox read-path behavior out of scope unless required for scheduler safety.
- All new behavior must be feature-flagged and rollbackable.
- Schema changes must include `npm run db:push` and post-push verification before closure.
- Multi-tenant fairness is mandatory: scheduler must enforce per-workspace quotas before consuming remaining global headroom.
- User directive lock: NTTAN replay validation is not required for Phase 172 plan execution.

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Phase overlap on shared scheduler files can invalidate assumptions mid-implementation.
  - Mitigation: serial dependency on Phase 171 locks + mandatory pre-flight conflict check for every 172 slice.
- Aggressive scale-up can increase lock contention and fail/retry churn.
  - Mitigation: staged ramp-up with explicit guardrail thresholds, deterministic auto step-down, and operator capacity pin.
- Fairness logic can regress dedupe guarantees under burst retries.
  - Mitigation: keep dispatch-key/idempotency semantics unchanged and gate rollout on duplicate-send invariant (`0`).

### Missing or ambiguous requirements (now locked)
- Quota promotion criteria were qualitative.
  - Mitigation: enforce numeric promotion/demotion thresholds for each ladder step.
- Coordination checkpoints on shared files were not explicitly tied to each implementation slice.
  - Mitigation: make pre-flight conflict checks mandatory in a dedicated coordination subphase.
- Per-workspace tier source was env-based in the initial 172b slice.
  - Mitigation: add dedicated schema/code migration subphase to move quota tier source to `WorkspaceSettings`.

### Multi-agent coordination gaps
- Shared files are currently modified in working tree and overlap with active phases.
  - Mitigation: add explicit coordination subphase (`172g`) and checklist-driven merge protocol before code execution.

### Testing / validation gaps
- Subphase `172b` currently has unit-level fairness coverage but no mixed-load integration simulation proving starvation resistance under real queue composition.
  - Mitigation: require mixed-workspace queue simulation/canary evidence as part of `172c` validation before promoting quotas.

### Residual closeout gap (this turn)
- Phase review, validation gates, and staging canary evidence are captured; rollout blocker from `highQuotaEnabled` tier state has been resolved via backfill.
  - Mitigation: keep promotion enablement behind runtime flag until the rollout window is approved.

### Post-canary follow-up risk (this turn)
- Promotion is still runtime-flag controlled and currently disabled by default.
  - Mitigation: enable promotion only with explicit rollout approval and continue reason-code monitoring.

## Scheduler + Gate Contracts (Decision Lock)

### Capacity contract
- `globalFloor = 1024`
- `globalTarget = max(1024, activeWorkspaceCount * 64)`
- `workspaceQuotaDefault = 64`
- `workspaceTierSource = WorkspaceSettings.highQuotaEnabled`
- `workspaceQuotaMax = 100`

### Quota promotion/demotion matrix (numeric)
- `64 -> 100` promotion gate:
  - queue-age p95 `< 180s` for `4` consecutive 30-minute windows
  - contention signal (`lock wait / retry storm`) below alert threshold for entire window
  - function failure-rate `< 0.5%`
  - duplicate-send invariant `= 0`
- Demotion triggers from `100 -> 64`:
  - duplicate-send invariant breach (`> 0`) immediate demotion + rollout stop
  - function failure-rate `>= 2.0%` for 2 consecutive 15-minute windows
  - sustained contention breach for 2 consecutive 15-minute windows

### Autoscale decision logging contract
Every scale decision record must include:
- `timestamp`
- `fromCapacity`
- `toCapacity`
- `reasonCode`
- `guardrailState`
- `operatorOverrideActive`
- `correlationId`

## Success Criteria
- Scheduler enforces both:
  - workspace-scaled global worker capacity (`floor=1024`, target from active workspace count, no fixed planning-time upper stop), and
  - per-workspace quotas (`64` default, `100` promoted tier only after gates pass).
- Under burst load, queue-age and completion metrics improve without duplicate customer-visible sends.
- Autoscaler decisions are explainable (reason codes logged for each scale-up/scale-down event).
- Autoscaler applies staged ramp-up and deterministic auto step-down, with each transition logged by reason code.
- Backpressure behavior is explicit and observable (no silent drops, no unbounded retries).
- Per-workspace quota ladder can progress from `64` to `100` only when numeric contention/error/SLO gates pass.
- Runbook + dashboard packet exists and includes rollback and emergency step-down instructions.
- Validation gates pass:
  - `npm run lint`
  - `npm run build`
  - `npm test`
- Mixed-workspace staging canary evidence exists showing no starvation under hot-tenant burst load.

## Multi-Agent Pre-Flight Conflict Check
- [ ] `git status --short` reviewed before each 172 implementation slice.
- [ ] Last 10 phases rescanned (`ls -dt docs/planning/phase-* | head -10`) and overlap notes recorded.
- [ ] Shared target files re-read immediately before edit (no cached assumptions).
- [ ] If overlap changed dispatch/idempotency contracts, pause slice and re-baseline acceptance gates.

## Assumptions (Agent)
- Phase 171 contract locks are authoritative for shared-file execution order in this phase (confidence ~95%).
- Existing dispatch-key/idempotency semantics remain non-negotiable while fairness/autoscale features are added (confidence ~95%).

## Decision Locks (2026-02-19)
- `highQuotaEnabled` migration backfill scope: all existing workspaces set `true` during cutover; all new workspaces default `false`.
- Env fallback policy: keep `BACKGROUND_JOB_ENTERPRISE_CLIENT_IDS` for one release cycle after DB cutover, remove on first stable production release after canary passes with no rollback.
- Tier semantics: `highQuotaEnabled=true` means eligibility for gated promotion, not immediate quota `100`.
- Ramp policy lock for `172c`: conservative staged ramp (`+64` every `5m` when healthy) and deterministic auto step-down (`50%` reduction on guardrail breach, never below floor).

## Open Questions (Need Human Input)
- None currently open for Phase 172 closeout.

## Subphase Index
* a — Capacity Model + Contract Lock (Global vs Workspace)
* b — Fair Scheduler + Per-Workspace Quota Enforcement
* c — Autoscaling Control Loop + Contention/Error Guardrails
* d — Partitioning, Backpressure, and Enterprise Quota Escalation Ladder
* e — Observability, Runbook, and Multi-Agent Coordination Guardrails
* f — Canary Validation and Go/No-Go Rollout Packet
* g — Numeric Gate Matrix and Coordination Lock
* h — WorkspaceSettings Tier Migration + Quota Source Cutover
* i — Autoscale Control Loop Execution (Conservative Ramp + Reason-Code Logging)
* j — Promotion Gate + Backpressure Execution (Partitioned Selection + Ladder Controls)
* k — Observability + Runbook Packet Execution (Alerts, Actions, Rollback)

## Phase Summary (running)
- 2026-02-19 — RED TEAM hardening pass applied to phase root plan: repo-reality verification, numeric quota gate matrix, and explicit multi-agent conflict checklist.
- 2026-02-19 — Completed subphase `172b` implementation slice: shipped workspace-fair queue ordering + quota-aware claim logic in background runner, added scheduler unit coverage, and documented new quota env controls (files: `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/fair-scheduler.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/runner.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/__tests__/background-job-fair-scheduler.test.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/scripts/test-orchestrator.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/README.md`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/.env.example`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-172/b/plan.md`).
- 2026-02-19 — RED TEAM wrap-up after `172b`: logged remaining validation risk (missing mixed-load starvation evidence) and carried it forward as an explicit `172c` gate.
- 2026-02-19 — Plan update lock applied from user decisions: DB-backed workspace tier source (`WorkspaceSettings`), global default quota raised to `64`, runner-first autoscale in `172c`, staging canary validation target, and NTTAN replay exclusion for this phase.
- 2026-02-19 — Terminus update pass aligned decision locks to `X=64`, renamed tier field to `WorkspaceSettings.highQuotaEnabled`, and codified staged ramp-up + automatic step-down policy across root/subphases (files: `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-172/plan.md`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-172/a/plan.md`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-172/c/plan.md`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-172/g/plan.md`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-172/h/plan.md`).
- 2026-02-19 — RED TEAM follow-up added human-decision gates for `highQuotaEnabled` backfill scope, env-allowlist deprecation window, and staged ramp step contract before `172c/172h` execution.
- 2026-02-19 — User decision lock applied: backfill all existing workspaces to `highQuotaEnabled=true`, keep one-release env fallback then remove on first stable post-canary release, tier flag means gated eligibility (not immediate 100), and `172c` ramp policy locked to conservative profile.
- 2026-02-19 — Implemented `172h` cutover slice: added `WorkspaceSettings.highQuotaEnabled` schema field, switched background-runner quota eligibility to DB-first with deprecated one-release env fallback, updated scheduler tests/docs, and validated with `db:push` + targeted tests/lint (files: `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/prisma/schema.prisma`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/fair-scheduler.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/runner.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/__tests__/background-job-fair-scheduler.test.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/README.md`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/.env.example`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-172/h/plan.md`).
- 2026-02-19 — Appended execution subphase `172i` to continue post-cutover autoscale implementation with decision-locked conservative ramp + reason-code telemetry.
- 2026-02-19 — Implemented `172i` autoscale slice: added deterministic autoscale helper + runner decision logging contract, integrated operator override/guardrail toggles, added autoscale unit coverage, and validated with targeted tests + eslint (files: `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/autoscale-control.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/runner.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/__tests__/background-job-autoscale-control.test.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/scripts/test-orchestrator.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/README.md`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/.env.example`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-172/i/plan.md`).
- 2026-02-19 — Appended execution subphase `172j` and implemented first `172d` slice: partitioned workspace selection, promotion-gate decision logic, and explicit backpressure signaling integrated in runner with targeted tests/docs updates.
- 2026-02-19 — Extended `172j` with demotion controls: added sustained breach demotion windows (`2x15m`) and immediate duplicate-send demotion path, with updated promotion-gate coverage and env/docs contracts.
- 2026-02-19 — Updated `172j` duplicate invariant source: promotion gate now reads durable duplicate signals from `BackgroundFunctionRun.lastError` window scan with env override fallback for staging control.
- 2026-02-19 — Full validation gate run completed: `npm run lint`, `npm run build`, and `npm test` all passed (warnings observed but no blocking errors), enabling transition into observability/runbook packet execution.
- 2026-02-19 — Executed `172k` operations packet slice: published scheduler alert/runbook/canary artifact (`docs/planning/phase-172/artifacts/operations-packet.md`) and captured full validation evidence for rollout readiness handoff.
- 2026-02-19 — Phase review pass executed: reran `npm run lint`, `npm run build`, `npm test`, and `npm run db:push`; wrote `docs/planning/phase-172/review.md` with criterion-to-evidence mapping and marked the staging canary artifact as the remaining closeout item.
- 2026-02-19 — Staging canary evidence run completed via live telemetry + authenticated Playwright cron probes + control-loop simulations; added artifacts `staging-canary-evidence-2026-02-19.md` and `staging-canary-simulations-2026-02-19.json`, establishing rollout-readiness evidence for this phase.
- 2026-02-19 — Applied workspace tier backfill in Supabase (`62` rows updated): `WorkspaceSettings.highQuotaEnabled` is now `true` for all existing workspaces (`62/62`), resolving the final rollout-policy blocker for Phase 172.
