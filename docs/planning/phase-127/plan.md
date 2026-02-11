# Phase 127 — Gated Long-Term Memory + Loop Observability + Retention

## Purpose
Introduce a safe, governed pathway for agents to propose durable memory (Lead + workspace signals) and improve robustness/observability of the evaluator↔revision loop, while keeping persistent run artifacts bounded via pruning.

## Context
Phase 123 shipped run-scoped cross-agent context (`DraftPipelineRun` + `DraftPipelineArtifact`) and a bounded evaluator↔revision loop (max 3 iterations). What’s still missing for “production-grade robustness” is:
- Governed *long-term* memory (agents can propose; system only commits approved, TTL-bounded facts).
- First-class loop observability (stop reasons, iteration deltas, cache-hit stats).
- Retention/pruning for run artifacts so the DB doesn’t grow unbounded.

This phase intentionally avoids “silent LLM writes” to durable memory.

## Decisions (Locked)
- Memory scope: **lead + workspace**
- Roles/UI: **Super Admin only**, surfaced in **Settings → Admin**
- Auto-approval policy (fail-closed):
  - category in allowlist
  - `confidence >= 0.7`
  - `ttlDays >= 1`
  - `ttlDays` is hard-capped to **90 days**
- Allowlist: **UI-configurable** (per-workspace policy, not code-only)
  - Empty allowlist disables auto-approval (all proposals become `PENDING`).
  - UI offers suggested defaults; rollout includes a one-time backfill script for existing workspaces.
- Redaction: **minimal scrub** (emails/phones scrubbed; URLs allowed)
- Loop model selection: **selectable in UI**, with **env var fallbacks** (no behavior break if unset)
  - evaluator: `AUTO_SEND_EVALUATOR_MODEL`, `AUTO_SEND_EVALUATOR_REASONING_EFFORT`
  - revision: `AUTO_SEND_REVISION_MODEL`, `AUTO_SEND_REVISION_REASONING_EFFORT`

## Concurrent Phases
Overlaps detected by scanning last 10 phases and current working tree.

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 123 | Complete (review present) | DraftPipelineRun/Artifact tables; auto-send revision loop | Build on Phase 123 artifacts and loop conventions; avoid prompt key churn. |
| Phase 124 | Active (local changes) | Settings/RBAC surfaces | Keep schema + actions changes isolated; don’t bundle RBAC edits into this phase’s commits. |
| Phase 125 | Active (local changes) | AI draft refresh domain | No overlap intended; avoid touching availability refresh modules. |
| Phase 126 | Active (local changes) | Prisma schema changes | Coordinate schema edits; run `npm run db:push` once after all schema changes are merged. |

## Objectives
* [x] Add governed long-term memory proposals: LLM proposes → system approves (allowlist + thresholds) → persist to `LeadMemoryEntry` and `WorkspaceMemoryEntry` with TTL and provenance.
* [x] Add Super Admin UI in Settings → Admin:
  - [x] Configure allowlist + thresholds (min confidence, min TTL, TTL cap)
  - [x] Review/approve/reject PENDING memory entries (lead + workspace)
  - [x] View auto-send loop observability (stop reasons, iteration deltas, cache hits)
* [x] Add pruning/retention for `DraftPipelineRun` + artifacts (default: 30 days).
* [x] Add loop observability: per-run stop reasons, iterations used, confidence deltas, and cache-hit counts.
* [x] Add tests for memory governance + pruning + observability.

## Constraints
- Never commit secrets/tokens/PII.
- Memory writes must be TTL-bounded and provenance-tracked.
- Approval must be explicit (allowlist + confidence threshold) and fail-closed.
- All persistent JSON payloads stored as artifacts must be capped (32KB) via `validateArtifactPayload()`.
- Prisma schema changes require `npm run db:push` against the correct DB before considering the phase done.
- Observability sinks:
  - Persist a compact run summary in `DraftPipelineArtifact` stage `auto_send_revision_loop` (no raw message text required).
  - Also persist stats-only events in `AIInteraction`/AI ops feed (no raw drafts/messages; counts/booleans only).

## Success Criteria
- [x] Durable memory proposals are stored and governed:
  - Safe allowlist categories auto-approve (with TTL + confidence threshold; TTL capped to 90d).
  - Non-allowlist categories persist as `PENDING` for Super Admin review in Settings → Admin.
  - Both lead-scoped and workspace-scoped entries are supported.
- [x] `DraftPipelineRun` retention is enforced (30d default) without impacting hot paths:
  - Pruning runs in cron/background job context and is bounded per invocation.
- [x] Auto-send loop observability exists:
  - Stop reason, iterations used, and confidence deltas are persisted per draft run and are queryable.
  - Super Admin UI can view recent loop summaries for a workspace.
- [x] Quality gates pass:
  - `npm test`, `npm run lint`, `npm run build`

## Subphase Index
* a — Data model + contracts (memory governance + policy settings + retention knobs)
* b — Agent output + approvals + UI surfaces (proposals, approve/reject, loop observability)
* c — Pruning + tests + docs (cron hooks, unit/integration tests, rollout notes)

## Phase Summary (running)
- 2026-02-09 — Added memory governance schema + workspace memory model + policy fields + TS contract scaffolding. (files: `prisma/schema.prisma`, `lib/memory-governance/types.ts`, `lib/memory-governance/redaction.ts`, `lib/draft-pipeline/types.ts`, `docs/planning/phase-127/a/plan.md`)
- 2026-02-09 — Completed governance wiring + loop observability + pruning/tests/docs; ran full quality gates. (files: `lib/memory-governance/persist.ts`, `lib/auto-send/revision-agent.ts`, `lib/auto-send/orchestrator.ts`, `lib/auto-send/loop-observability.ts`, `actions/memory-governance-actions.ts`, `components/dashboard/confidence-control-plane.tsx`, `app/api/cron/background-jobs/route.ts`, `README.md`, `scripts/test-orchestrator.ts`)
- 2026-02-10 — Empty allowlist now disables auto-approval (fail-closed); UI shows suggested defaults and added one-time backfill script. (files: `lib/memory-governance/policy.ts`, `actions/memory-governance-actions.ts`, `components/dashboard/confidence-control-plane.tsx`, `scripts/backfill-memory-allowlist-defaults.ts`, `lib/__tests__/memory-governance.test.ts`)
