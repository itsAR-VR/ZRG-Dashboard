# Phase 165 — Inngest-First Background Orchestration Replacement (Retire Inline Cron Processing)

## Purpose
Replace the current hybrid background-job execution model with a robust, Inngest-first orchestration system that prevents timeout cascades, reduces duplicate work, and stabilizes overall platform performance under load.

## Context
- Current background execution still allows inline fallback from `/api/cron/background-jobs`, which can consume request runtime and compete with user-facing traffic during failure bursts.
- We already have Inngest wired (`/api/inngest`, function registry, cron enqueue gate), but the operational model is still mixed and can degrade into expensive inline processing.
- User requirement: build a robust replacement plan (not incremental patchwork), with database-backed reliability guarantees and cross-verification against Inngest docs/MCP guidance where available.
- This phase follows Karpathy-style guardrails:
  - explicit assumptions,
  - minimal necessary complexity,
  - verifiable outcomes,
  - no unrelated refactors.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 162 | Active | AI + background processing adjacent files (`lib/background-jobs/*`, `lib/followup-engine.ts`) | Re-read target files before edits; avoid stomping 162 semantics; merge semantically. |
| Phase 164 | Active | Platform perf stabilization (`/api/inbox/*`, runtime contention concerns) | Keep 165 focused on background execution path; use 164 perf evidence as before/after baseline. |
| Phase 155 | Completed baseline | Existing Inngest wiring and rollout conventions | Treat as foundation; do not regress env isolation, flag behavior, or canary expectations. |
| Phase 167 | Active | Timeout hardening in inbox/webhook/cron paths | Avoid overlapping edits; keep 165 scoped to background dispatch + Inngest orchestration only. |
| Phase 168 | Active | Live speed verification initiative with overlapping runtime domains | Coordinate through plan docs and avoid modifying 168-owned runtime paths in 165 scope. |

## Objectives
* [x] Define and adopt a single execution authority: cron dispatch + Inngest durable execution (inline processing retired by default).
* [x] Add explicit idempotency, duplicate-prevention, and retry/backoff safety for background dispatch and execution.
* [x] Design and implement database schema improvements for reliable job-run traceability, dead-lettering, and recovery.
* [x] Harden background workers for partial-failure handling, deterministic retries, and observability.
* [ ] Verify no regression to AI/message/reply paths with explicit NTTAN validation gates.
* [ ] Ship a canary rollout + rollback plan with measurable SLOs and failure stop-gates.

## Constraints
- No secrets/tokens/cookies committed.
- Keep auth requirements on cron/admin endpoints intact (`Authorization: Bearer <CRON_SECRET>`).
- Preserve tenant isolation: no cross-client leakage in keys, events, logs, or caches.
- Minimize production risk via additive migration and feature-flagged cutover.
- Schema changes must include `npm run db:push` and verification steps before closure.
- Keep scope to background orchestration and related reliability surfaces; no unrelated UI/feature refactors.

## Success Criteria
- `/api/cron/background-jobs` runs in dispatch-only mode by default and returns quickly (`202`/`200`) without inline heavy execution.
- Duplicate cron ticks within the same dispatch window do not produce duplicate durable processing.
- Inngest functions enforce explicit concurrency controls and burst control policy (debounce/rate-limit where needed).
- Background failures are observable with durable run records (attempts, start/end timestamps, terminal reason).
- Dead-letter or terminal-failure path exists and is queryable for operator triage.
- Platform impact target: background orchestration no longer causes request-path timeout spikes attributable to inline fallback behavior.
- Validation gates pass:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
  - `npm test`
- NTTAN gates pass (required due message/reply/background processing impact):
  - `npm run test:ai-drafts`
  - `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
  - `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`

## Repo Reality Check (RED TEAM)
- What exists today:
  - Cron dispatch route now uses deterministic dispatch keys + event IDs and dispatch-window duplicate suppression.
  - Inngest background functions now enforce dispatch-key idempotency and persist correlated run metadata.
  - Durable reliability models are present in Prisma (`BackgroundDispatchWindow`, `BackgroundFunctionRun`) and synced to DB.
- What the plan assumes:
  - Dispatch mode remains the steady-state production mode.
  - Replay gating is required for full closure, but can be infra-blocked by DB reachability.
- Verified touch points:
  - `app/api/cron/background-jobs/route.ts`
  - `lib/background-jobs/dispatch.ts`
  - `lib/background-jobs/dispatch-ledger.ts`
  - `lib/inngest/functions/process-background-jobs.ts`
  - `lib/inngest/functions/background-maintenance.ts`
  - `lib/inngest/job-status.ts`
  - `prisma/schema.prisma`
  - `README.md`

## RED TEAM Findings (Gaps / Weak Spots)
### Highest-risk failure modes
- Replay validation blocker can hide message/reply regressions.
  - Mitigation: keep phase status partial until replay dry/live commands pass from reachable network path.

### Missing or ambiguous requirements
- Production toggle strategy for emergency inline fallback is still an operator decision.
  - Mitigation: keep default fallback disabled and require explicit incident-time enablement.

### Performance / timeouts
- Background dispatch fixes do not address inbox/webhook timeout domains from phases `167/168`.
  - Mitigation: preserve phase isolation and coordinate evidence across phases rather than cross-editing.

### Testing / validation
- NTTAN replay commands currently blocked by DB connectivity in this environment.
  - Mitigation: captured artifacts + blocker details in 165d/165e; rerun required before final closure.

## Open Questions (Need Human Input)
- [ ] Should production keep `BACKGROUND_JOBS_INLINE_EMERGENCY_FALLBACK` disabled by default and only enable during incidents? (confidence ~88%)
  - Why it matters: enabling fallback increases resilience to enqueue failures but can reintroduce request-path load during incidents.
  - Current assumption in this plan: default `false`, incident-only temporary enablement.

- [ ] Do you want this phase to force `BACKGROUND_JOBS_USE_INNGEST=true` explicitly in production, or rely on auto-dispatch when `INNGEST_EVENT_KEY` is present? (confidence ~85%)
  - Why it matters: explicit flag setting gives clearer operator intent; auto mode reduces env config drift.
  - Current assumption in this plan: auto-dispatch is acceptable unless operations policy requires explicit forcing.

## Phase Summary (running)
- 2026-02-17 21:53Z — Implemented Phase 165 core replacement: deterministic dispatch keys/events, dispatch-only cron default, explicit emergency flags, durable dispatch/run ledgers, and function-level idempotency. (files: `app/api/cron/background-jobs/route.ts`, `lib/background-jobs/dispatch.ts`, `lib/background-jobs/dispatch-ledger.ts`, `lib/inngest/events.ts`, `lib/inngest/functions/process-background-jobs.ts`, `lib/inngest/functions/background-maintenance.ts`, `lib/inngest/job-status.ts`, `prisma/schema.prisma`, `lib/__tests__/background-dispatch.test.ts`, `README.md`)
- 2026-02-17 21:53Z — Validation pass complete for lint/typecheck/build/test/ai-drafts + schema sync (`db:push`); replay dry/live blocked by DB connectivity preflight with artifacts captured under `.artifacts/ai-replay/`.

## Subphase Index
* a — Architecture + Inngest Spec Cross-Verification
* b — Database Reliability Model + Migration Plan
* c — Cron Dispatch Cutover + Inngest Orchestration Refactor
* d — Worker Idempotency/Failure Semantics + Observability Hardening
* e — Validation, Canary Rollout, and Rollback Readiness
