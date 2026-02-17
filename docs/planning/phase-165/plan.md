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

## Objectives
* [ ] Define and adopt a single execution authority: cron dispatch + Inngest durable execution (inline processing retired by default).
* [ ] Add explicit idempotency, duplicate-prevention, and retry/backoff safety for background dispatch and execution.
* [ ] Design and implement database schema improvements for reliable job-run traceability, dead-lettering, and recovery.
* [ ] Harden background workers for partial-failure handling, deterministic retries, and observability.
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

## Subphase Index
* a — Architecture + Inngest Spec Cross-Verification
* b — Database Reliability Model + Migration Plan
* c — Cron Dispatch Cutover + Inngest Orchestration Refactor
* d — Worker Idempotency/Failure Semantics + Observability Hardening
* e — Validation, Canary Rollout, and Rollback Readiness

- 2026-02-17 — Terminus Maximus retroactive validation completed for Phase 165: global gates passed (lint/typecheck/build/test), review artifact present (docs/planning/phase-165/review.md), and subphase Output/Handoff integrity verified.
