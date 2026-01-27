# Phase 61 — Review

## Summary
- Phase 61 is implemented in the working tree: dedicated `/api/cron/availability` refresh loop, tighter TTL, past-slot filtering, and multi-agency fairness.
- EmailBison first-touch `availability_slot` injection now relies on the availability cron (no calendar-provider fetch on that path) and has per-workspace UI controls + preview.
- Quality gates ran cleanly on 2026-01-27 (db:push, lint, build) with warnings only.

## What Shipped

### Availability refresh
- New cron route: `app/api/cron/availability/route.ts`
  - Auth: `Authorization: Bearer ${CRON_SECRET}` (legacy `x-cron-secret` supported)
  - Postgres advisory lock prevents overlapping runs (`pg_try_advisory_lock`)
  - Calls `refreshAvailabilityCachesDue({ mode: "all", timeBudgetMs, concurrency })`
- `vercel.json` schedules `/api/cron/availability` every minute.

### Cache safety + scale
- `lib/availability-cache.ts`
  - TTL default 60s via `AVAILABILITY_CACHE_TTL_MS`
  - Defensive filter strips past/bad slot ISO strings in `getWorkspaceAvailabilitySlotsUtc()`
  - `refreshAvailabilityCachesDue()` supports:
    - `mode: "all"` and due-mode batching
    - oldest-first ordering (`staleAt: "asc"`)
    - time budget + bounded worker pool
    - multi-agency interleaving by `Client.userId`
    - response metrics: total/due/erroring + oldest successful refresh age (via `rangeStart`)

### Cron coordination
- `app/api/cron/followups/route.ts` no longer refreshes availability; follow-ups assume the availability cron keeps caches warm.

### EmailBison `availability_slot` (per workspace)
- `lib/emailbison-first-touch-availability.ts` uses `getWorkspaceAvailabilitySlotsUtc(..., { refreshIfStale: false })` so it doesn't hit calendar providers.
- `prisma/schema.prisma` adds per-workspace controls under `WorkspaceSettings`:
  - enable toggle, include weekends, offer count (1–2), prefer-within-days, optional sentence template
- UI: `components/dashboard/settings-view.tsx` “EmailBison First-Touch Times” card with a “Preview current value” action.
- Server action: `actions/emailbison-availability-slot-actions.ts` (preview helper used by the settings UI).

## Verification

### Evidence snapshot
- Branch: `main`
- HEAD: `cc76dc10b61d6ecbfe1ba9dd4b370c35e44e4f4a`
- Working tree (uncommitted):
  - Modified: `actions/settings-actions.ts`, `app/api/cron/followups/route.ts`, `lib/availability-cache.ts`, `lib/emailbison-first-touch-availability.ts`, `prisma/schema.prisma`, `vercel.json`
  - Untracked: `actions/emailbison-availability-slot-actions.ts`, `app/api/cron/availability/`, `docs/planning/phase-61/`, `docs/planning/phase-62/`
- Recent phases (mtime): `docs/planning/phase-62`, `docs/planning/phase-61`, `docs/planning/phase-60`, `docs/planning/phase-59`, ...

### Commands
- `npm run db:push` — pass (2026-01-27T18:15:37+03:00) — database already in sync
- `npm run lint` — pass with warnings (2026-01-27T18:16:04+03:00) — 0 errors, 18 warnings
- `npm run build` — pass (2026-01-27T18:16:27+03:00)
  - Noted warnings: Next.js workspace-root inference (multiple lockfiles), middleware deprecation warning.

## Success Criteria → Evidence

1. Dedicated `/api/cron/availability` exists and runs every minute
   - Evidence: `app/api/cron/availability/route.ts`, `vercel.json` cron entry
   - Status: met (implementation)

2. Past dates are filtered from availability returned to downstream callers
   - Evidence: `lib/availability-cache.ts:getWorkspaceAvailabilitySlotsUtc()` strips past/bad ISO strings + logs
   - Status: met

3. Multi-agency fairness + no starvation under load
   - Evidence: `refreshAvailabilityCachesDue()` orders by `staleAt: "asc"` and interleaves by `Client.userId`
   - Status: met (implementation)

4. Cron response includes staleness/error metrics
   - Evidence: `refreshAvailabilityCachesDue()` returns `metrics` incl. `oldestSuccessfulRangeStartAgeMinutes`
   - Status: met

5. EmailBison first-touch injection uses cached availability only + per-workspace controls
   - Evidence: `lib/emailbison-first-touch-availability.ts` uses `refreshIfStale: false`; settings fields in `prisma/schema.prisma`; UI preview in `components/dashboard/settings-view.tsx`
   - Status: met (implementation)

6. Manual test: stale cache refreshed within 1 minute in production
   - Evidence: not executed in this review
   - Status: not met (pending deploy)

## Risks / Notes
- “Every workspace refreshed every minute” is achievable only if provider latency + concurrency fit inside the ~55s budget; tune `AVAILABILITY_CRON_CONCURRENCY` and monitor `attempted/refreshed/finishedWithinBudget` metrics.
- Advisory lock means overlapping invocations will report `skipped: true` instead of running concurrently.

## Next Steps
- Commit + deploy to staging/prod, then verify:
  - `/api/cron/availability` metrics trend toward low `dueCaches` and low `oldestSuccessfulRangeStartAgeMinutes`
  - EmailBison injection shows non-null preview values for a workspace with cached slots
