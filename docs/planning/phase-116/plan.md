# Phase 116 — Auto-Send Revision Tracking + Launch Readiness

## Purpose
Finalize production readiness for the Phase 115 AI auto-send revision loop by adding durable DB tracking, retry-safe idempotency, better operator visibility, and a concrete launch/rollback runbook.

## Context
- Phase 115 shipped a bounded revision loop for **AI_AUTO_SEND** (campaign mode): evaluate → (if confidence < threshold and not a deterministic hard block) select optimization context → revise → re-evaluate once.
- Phase 115 explicitly deferred schema-level revision tracking fields on `AIDraft` (RT-17) to avoid DB migration work at the time.
- Without durable tracking, retries can repeatedly attempt revision (cost/latency), and operators can’t easily filter/measure “revised then sent” outcomes from DB-backed views.
- User intent for Phase 116: build on committed Phase 115 work and get the system **production ready** and **launch ready**, including a RED TEAM sweep for remaining weak spots.

## Concurrent Phases
No active concurrent uncommitted work detected at planning time (`git status --porcelain` clean). This phase builds on shipped phases that touched the same surfaces:

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 115 | Shipped | `lib/auto-send/*`, `lib/ai/prompt-registry.ts`, AI Ops visibility | Build on top. Keep revision bounded + fail-closed. |
| Phase 114 | Shipped | Admin Dashboard + AI Ops (last 3 days) | Extend existing admin snapshot/panels with stats-only revision visibility. |
| Phase 112 | Shipped | AIInteraction telemetry + metadata policy | Keep telemetry metadata stats-only; do not add raw text. |

## Repo Reality Check (RED TEAM)
- What exists today:
  - Auto-send revision loop is already implemented (Phase 115):
    - Orchestrator integration: `lib/auto-send/orchestrator.ts` calls `maybeReviseAutoSendDraft(...)` when confidence is below threshold (model-based only).
    - Revision pipeline + persistence of improved draft content: `lib/auto-send/revision-agent.ts`.
  - Workspace-level rollout toggles already exist on `WorkspaceSettings` and are super-admin controlled:
    - Schema fields: `WorkspaceSettings.leadContextBundleEnabled`, `WorkspaceSettings.followupBookingGateEnabled`
    - Server actions: `actions/lead-context-bundle-rollout-actions.ts` (true super-admin gating)
    - UI: `components/dashboard/confidence-control-plane.tsx` (super-admin control plane)
  - DB model has auto-send evaluation fields but no revision tracking yet:
    - `prisma/schema.prisma` → `model AIDraft` includes `autoSendConfidence`, `autoSendAction`, etc; missing revision-attempt fields (deferred in Phase 115).
  - Operator visibility primitives exist:
    - Admin dashboard health snapshot: `actions/admin-dashboard-actions.ts` + `components/dashboard/admin-dashboard-tab.tsx`.
    - AI Ops events (last 3 days): `actions/ai-ops-feed-actions.ts` + `components/dashboard/ai-ops-panel.tsx` (featureIds include `auto_send.context_select` + `auto_send.revise`).
- What this plan assumes:
  - A revision attempt should be **at most once per `AIDraft.id`**, even if background jobs retry.
  - Revision gating should be **per-workspace** (canary one client in production), with a global env kill-switch as an emergency brake.
  - Revision tracking can be stored on `AIDraft` (no new tables required).
- Verified touch points:
  - `lib/auto-send/orchestrator.ts` — revision gating inserted between first eval and send/schedule decision.
  - `lib/auto-send/revision-agent.ts` — revision helper supports DB writes via `db.aIDraft.updateMany(...)`.
  - `actions/admin-dashboard-actions.ts` — already reports env + draft queue health; safe place to add revision kill-switch + counts.

## Objectives
* [x] Add schema-level revision tracking fields on `AIDraft` and sync DB (`npm run db:push` + verify).
* [x] Enforce **at-most-once** revision attempt per `AIDraft.id` (retry-safe).
* [x] Persist original vs revised confidence and whether revision was applied.
* [x] Tighten revision-agent correctness (fix JSON schema duplication) and expand tests.
* [x] Add a per-workspace **auto-send revision enable/disable** toggle (super-admin controlled).
* [x] Add stats-only operator visibility for revision health/effectiveness (admin surfaces).
* [x] Produce a launch checklist and rollback plan (Vercel envs + smoke tests + monitoring).

## Constraints
- Scope: **AI_AUTO_SEND only**. No changes to LEGACY_AUTO_REPLY.
- PII hygiene: never store raw inbound/draft text in `AIInteraction.metadata` (stats-only only).
- Revision remains bounded and fail-closed:
  - max 1 selector call
  - max 1 reviser call
  - max 1 re-eval call
- Prisma: if `prisma/schema.prisma` changes, run `npm run db:push` (ensure `DIRECT_URL` is set for Prisma CLI).
- Preserve rollback levers:
  - `AUTO_SEND_REVISION_DISABLED=1` disables selector/reviser while leaving evaluator behavior unchanged.
  - `AUTO_SEND_DISABLED=1` disables auto-send globally.
- Per-workspace gating:
  - Revision runs only when `WorkspaceSettings.autoSendRevisionEnabled=true` AND `AUTO_SEND_REVISION_DISABLED` is not `"1"`.

## Success Criteria
- [x] `AIDraft` has durable revision tracking fields and they are present in the database.
- [x] A single `AIDraft.id` cannot run the revision pipeline more than once (even across job retries).
- [x] `AIDraft.autoSendConfidence` remains the confidence that actually drove the send/review decision; new fields store pre-revision and revision-attempt values.
- [x] Unit tests cover idempotent gating + persistence semantics.
- [x] `npm test`, `npm run lint`, `npm run build` pass.
- [ ] Launch runbook exercised in canary: enable revision for **one workspace** (super-admin toggle) without deploy; no elevated errors/timeouts; operator visibility works.

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Repeated revision attempts on job retries (cost/latency + noisy ops) → add DB-backed one-time “attempt claim” (`autoSendRevisionAttemptedAt`) in Phase 116b/116c.
- Prisma schema pushed to the wrong database → Phase 116b requires explicit `DIRECT_URL` verification + Studio/SQL column verification before deploy.
- Operators can’t tell whether revision is disabled in prod → Phase 116d adds `AUTO_SEND_REVISION_DISABLED` visibility in Admin Dashboard snapshot.
- Telemetry accidentally stores raw content → Phase 116 explicitly stores only numeric/boolean fields on `AIDraft` and keeps `AIInteraction.metadata` stats-only.

### Missing or ambiguous requirements
- Per-workspace canary requirement confirmed by user: implement `WorkspaceSettings.autoSendRevisionEnabled` and a super-admin toggle UI (Confidence Control Plane).

### Testing / validation gaps to cover
- Add tests for “attempt already claimed” gating and “claim write fails → fail closed (no revision)”.
- Add `npm run typecheck` to the quality-gate checklist to catch TS drift early (optional but recommended).

## Assumptions (Agent)
- Per-workspace rollout toggle should be **true super-admin only** (confidence ~90%).
  - Mitigation check: if you want workspace admins to control this, move the toggle into the general settings UI and gate by `requireClientAdminAccess` instead.
- Revision should be attempted at most once per draft forever (confidence ~95%).
  - Mitigation check: if you want “retry revision after X hours”, add `autoSendRevisionAttemptCount` + a cooldown window instead.

## Additional Weak Spots (Post-Launch Backlog)
- Admin metrics are currently counts-only (attempted/applied). If you want deeper insight, add derived stats like avg confidence delta, p50/p95 revision latency, and applied-rate by channel/campaign.
- UI gating: Confidence Control Plane is hidden behind "global admin" UI gating, while the toggle server action enforces true-super-admin. If global admins exist that are not true-super-admins, add a dedicated `getTrueSuperAdminStatus()` and gate the UI accordingly.
- DB operations: Prisma `db push` creates indexes non-concurrently; if `AIDraft` grows large, plan a dedicated migration path that uses concurrent index creation to minimize locks.

## Subphase Index
* a — Acceptance tests + launch checklist (production readiness audit)
* b — Prisma schema: `AIDraft` revision tracking fields + DB sync + verification
* c — Revision agent: idempotent attempt claim + field persistence + bug fixes + tests
* d — Rollout controls + observability: super-admin toggle + admin visibility (stats-only)
* e — Production rollout: envs, smoke tests, monitoring, rollback

## Phase Summary (running)
- 2026-02-07 05:28 EST — Implemented DB-backed auto-send revision tracking + idempotency, added per-workspace super-admin toggle and admin observability, and ran full quality gates + `db:push`. (files: `prisma/schema.prisma`, `lib/auto-send/revision-agent.ts`, `lib/auto-send/orchestrator.ts`, `actions/auto-send-revision-rollout-actions.ts`, `components/dashboard/confidence-control-plane.tsx`, `actions/admin-dashboard-actions.ts`, `components/dashboard/admin-dashboard-tab.tsx`)

## Phase Summary
- Shipped:
  - DB-backed revision tracking fields on `AIDraft` and a per-workspace rollout toggle on `WorkspaceSettings`.
  - Idempotent revision-attempt claim to prevent repeated selector/reviser calls on retries.
  - Super-admin rollout toggle UI + admin snapshot visibility (kill-switch + attempted/applied counts).
- Verified:
  - `npm run typecheck`: pass
  - `npm test`: pass
  - `npm run lint`: pass (warnings only, pre-existing)
  - `npm run build`: pass
  - `npm run db:push`: pass
- Notes:
  - Canary execution in production is still pending (manual operator step; see `docs/planning/phase-116/e/plan.md`).
