# Phase 67 — Deployment Readiness + AI Auto Launch + Zero-Error Gate

## Purpose
Ship a cohesive, production-ready build by consolidating recent unpushed changes, enabling both AI auto-send and auto-booking safely, and eliminating all known error signatures before a direct-to-production deploy.

## Context
The working tree contains uncommitted changes across availability caching, booking/auto-booking, follow-ups, and Prisma schema updates. Recent phases (62–66) overlap in these areas and require coordination. Production log scans (`npm run logs:check`) currently report six known error signatures that must be driven to zero. The deployment target is **direct to production**, and “AI auto setting started” means **both** AI auto-send and auto-booking should be live with safety gates and observability.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 66 | Implemented in working tree | `lib/followup-automation.ts`, `actions/email-actions.ts`, `lib/inbound-post-process/pipeline.ts`, `scripts/migrate-followups-phase-66.ts` | Must validate migration + rollout order before deploy |
| Phase 65 | Complete | `lib/ai/prompt-runner/runner.ts` | Ensure max_output_tokens handling changes don’t regress timeout fix |
| Phase 64 | Complete | `lib/ai-drafts.ts`, `lib/meeting-booking-provider.ts` | Booking link resolution must remain aligned |
| Phase 63 | Complete | `lib/supabase/middleware.ts`, `actions/analytics-actions.ts`, `lib/ghl-api.ts`, `lib/ai-drafts.ts` | Error-signature fixes must build on Phase 63 hardening |
| Phase 62 | Implemented + uncommitted 62j | `prisma/schema.prisma`, `lib/availability-cache.ts`, `lib/booking.ts`, `lib/followup-engine.ts` | AvailabilitySource + dual booking target are core dependencies |

## Objectives
* [ ] Inventory and consolidate all unpushed changes into a coherent release plan with clear commit boundaries.
* [ ] Eliminate **all** known production error signatures (logs:check must return zero).
* [ ] Make AI auto-send and auto-booking production-ready with safety gates and tests.
* [ ] Apply schema changes and migrations safely (preflight, canary, rollback-ready).
* [ ] Update phase docs and complete a red-team review for deployment readiness.

## Constraints
- **Direct-to-prod**: no preview/staging gate; rollback plan required.
- **Zero known errors**: `npm run logs:check` must return 0 for production logs after deploy.
- **No secrets/PII** in logs or artifacts (redaction required).
- Webhooks and cron endpoints remain auth-guarded; do not weaken security checks.
- If `prisma/schema.prisma` changes, `npm run db:push` is mandatory (with preflight dedupe).

## Success Criteria
- [ ] Working tree clean; changes grouped into clear commits on a release branch.
- [x] `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` all pass.
- [ ] Schema changes applied safely (`db:push` with dedupe/preflight documented).
- [ ] Phase 66 migration applied (canary + full) with rollback artifact captured.
- [ ] AI auto-send and auto-book smoke tests pass with safety gating.
- [ ] Post-deploy `npm run logs:check` against production log export shows **0** hits.
- [ ] Phase 62–66 reviews updated and a Phase 67 red-team review documented.

## Subphase Index
* a — Inventory + consolidation plan for unpushed changes
* b — Zero-known-error hardening (AI, Supabase, analytics, GHL)
* c — AI auto-send + auto-book readiness and tests
* d — Schema + migration rollout (preflight, canary, rollback)
* e — Docs, red-team review, and release checklist

## Artifacts Created

- ✅ `docs/planning/phase-67/a/inventory.md` – file-to-phase map of uncommitted work
- ✅ `docs/planning/phase-67/b/inventory.md` – error signature analysis (most already fixed in Phase 63)
- ✅ `docs/planning/phase-67/c/smoke.md` – AI auto-send + auto-book test checklist
- ✅ `docs/planning/phase-67/d/db-preflight.md` – SQL checks (pending verification)
- ✅ `docs/planning/phase-67/release-checklist.md` – deployment gate summary
- ✅ `docs/planning/phase-67/review.md` – post-implementation review snapshot
- ✅ `docs/planning/phase-67/red-team.md` – release risk review + mitigations

## Current Status

- 67a: Inventory updated for current working tree (tracked changes + untracked docs).
- 67b: Supabase cookie pre-validation added; analytics error logging downgraded to warn.
- 67c: Auto-send global kill-switch tests added; smoke checklist exists.
- 67d: DB preflight remains pending in this environment (no DB access used here).
- 67e: Release checklist exists; red-team doc added; Phase 63/64 review updates still pending.

## Changes Made

1. **`lib/supabase/middleware.ts`**: Added auth cookie pre-validation and refresh-token gating to prevent `refresh_token_not_found` errors.
2. **`lib/auto-send/__tests__/orchestrator.test.ts`**: Added kill-switch test coverage.
3. **`actions/analytics-actions.ts`**: Response-time calculation failure now logs at warn level.
4. **`components/dashboard/followup-sequence-manager.tsx`**: Built-in trigger labels/tooltips for Phase 66 semantics.
5. **`components/dashboard/crm-drawer.tsx`**: Show follow-up instance start date in UI.
6. **`components/dashboard/settings-view.tsx`**: Sentinel for “Same as default” direct-book calendar selection (GHL).

## Deploy Readiness

Pre-deploy gates executed locally:
- `npm run lint` ✅ (0 errors; warnings only)
- `npm run typecheck` ✅
- `npm test` ✅
- `npm run build` ✅

Remaining before production deploy:
- `db:push` (if schema changes reintroduced)
- Phase 66 migration (canary + full)
- Production smoke tests
- Post-deploy logs:check (0 hits)

## Phase Summary

- Shipped:
  - Phase 67 artifacts are present on disk: `docs/planning/phase-67/a/inventory.md`, `docs/planning/phase-67/b/inventory.md`, `docs/planning/phase-67/c/smoke.md`, `docs/planning/phase-67/d/db-preflight.md`, `docs/planning/phase-67/release-checklist.md`.
  - Phase 67 red-team review documented: `docs/planning/phase-67/red-team.md`.
  - Auto-send kill-switch is available in code (`lib/auto-send/orchestrator.ts`, `lib/auto-send/index.ts`).
  - Analytics response-time error logging is warn-level (`actions/analytics-actions.ts`).
- Verified:
  - `npm run lint`: pass (warnings only)
  - `npm run typecheck`: pass
  - `npm test`: pass
  - `npm run build`: pass
  - `npm run db:push`: skipped (no schema changes in working tree)
- Notes:
  - Release-branch creation, schema rollout, Phase 66 migration, smoke tests, and post-deploy log checks remain pending.
