# Phase 67a — Inventory of Unpushed Changes

## Current State

**Branch:** `main` (tracking `origin/main`)
**Working tree:** has tracked modifications + untracked docs

## Changed Files (tracked)

| File | Scope | Purpose |
|------|-------|---------|
| `components/dashboard/crm-drawer.tsx` | UI | Show follow-up instance `startedAt` and improve status layout. |
| `components/dashboard/followup-sequence-manager.tsx` | UI | Display built-in trigger labels/tooltips; make trigger selector read-only for built-ins. |
| `components/dashboard/settings-view.tsx` | UI | Use a sentinel value for “Same as default” direct-book calendar selection (GHL). |
| `lib/supabase/middleware.ts` | Auth | Pre-validate Supabase auth cookies; clear invalid/missing refresh tokens before `getUser()` to avoid `refresh_token_not_found`. |
| `lib/auto-send/__tests__/orchestrator.test.ts` | Tests | Add global kill-switch (`AUTO_SEND_DISABLED`) test coverage. |
| `docs/planning/phase-67/plan.md` | Docs | Phase 67 status/summary updates. |

## Untracked Files/Dirs

| Path | Status | Notes |
|------|--------|-------|
| `docs/planning/phase-67/review.md` | New | Phase 67 review artifact |
| `docs/planning/phase-68/` | New | Out of scope for Phase 67; leave untracked unless explicitly requested |

## Overlap Analysis

- UI changes touch follow-up sequencing surfaces and align with Phase 66 trigger refactor; no direct code-path conflicts.
- Auth middleware change builds on Phase 63 hardening; no schema overlap.
- Auto-send tests align with Phase 67c objectives.

## Commit Grouping Plan (if/when commits are requested)

1. **UI follow-up clarity** — `crm-drawer.tsx`, `followup-sequence-manager.tsx`, `settings-view.tsx`
2. **Auth + tests hardening** — `lib/supabase/middleware.ts`, `lib/auto-send/__tests__/orchestrator.test.ts`
3. **Docs** — `docs/planning/phase-67/*`

## Pre-Commit Validation

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
