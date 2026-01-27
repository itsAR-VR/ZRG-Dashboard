# Phase 61e — Throughput Hardening: Ordering, Budgets, Locking, Metric Correctness

## Focus
Make the (Phase 61b) dedicated availability cron safe and effective at a 1‑minute cadence by:
1) prioritizing the stalest caches first (no starvation),
2) adding an explicit time budget + concurrency controls (avoid timeouts),
3) preventing overlapping runs (avoid thundering herd),
4) ensuring staleness metrics reflect “last successful refresh” rather than refresh attempts.

## Inputs
- `lib/availability-cache.ts`
  - `refreshWorkspaceAvailabilityCache()`
  - `refreshAvailabilityCachesDue()`
  - `getWorkspaceAvailabilityCache()` / `getWorkspaceAvailabilitySlotsUtc()`
- `app/api/cron/availability/route.ts` (Phase 61b)
- `app/api/cron/followups/route.ts` (current availability refresh)
- `vercel.json` cron cadence (followups already `* * * * *` from Phase 59)
- Existing time-budget/locking patterns: `lib/background-jobs/runner.ts`
- Decisions locked in Phase 61:
  - Tighten availability cache TTL (target: ~1 minute; higher provider load is acceptable)
  - Keep 30‑day lookahead window (no change)

## Work

### 1) Prevent starvation (explicit ordering)
- Update `refreshAvailabilityCachesDue()` stale-cache selection to refresh the “oldest due” caches first.
  - Add `orderBy: { staleAt: "asc" }` to the stale-cache query.
  - Consider reserving a small slice of each run for “missing cache” workspaces so they don’t starve behind an always-stale set.

### 2) Add a time budget + bounded concurrency
- Introduce env vars (names TBD; document in Phase 61d/README):
  - `AVAILABILITY_CRON_TIME_BUDGET_MS` (default: 45_000)
  - `AVAILABILITY_CRON_CONCURRENCY` (default: 5–10)
  - `AVAILABILITY_CACHE_TTL_MS` (default: 60_000)
- Implement a small worker pool in `refreshAvailabilityCachesDue()`:
  - Stop starting new refreshes when within ~2–7 seconds of the deadline.
  - Return a `finishedWithinBudget` boolean and counts like `attempted`, `refreshed`, `skipped*`, `errors`.
- Keep provider safety in mind:
  - Start with a conservative concurrency and only increase once error rates are stable.

### 3) Prevent overlapping cron runs (lock)
- Add overlap protection to `app/api/cron/availability/route.ts`:
  - Preferred: Postgres advisory lock via `prisma.$queryRaw` + a stable lock key (no schema changes).
  - If the lock is already held: return `200` with `{ success: true, skipped: true, reason: "locked" }` (avoid retries/alert noise).
  - Always release the lock in a `finally` block.

### 4) Fix staleness metrics to match “last successful refresh”
- Avoid relying only on `fetchedAt` for staleness metrics; it is updated on refresh failures.
- Prefer a “last successful refresh” proxy:
  - `rangeStart` is updated on successful refresh and is not updated by the error-only upsert (making it a safer proxy).
- Extend metrics to include error health:
  - `erroringCaches` = caches with `lastError != null`
  - `staleDue` = caches with `staleAt <= now`
  - `oldestRangeStartAgeMinutes` = now − min(rangeStart)

### 5) Followups fallback decision (coordination with Phase 59)
- Decide whether `/api/cron/followups` should keep refreshing availability once `/api/cron/availability` is live:
  - If disabling, update parsing in `/api/cron/followups` to allow `AVAILABILITY_CRON_LIMIT=0` (it currently forces a minimum of 1).
  - If keeping as backup, set a low limit and/or gate it behind a distinct env var to avoid doubling load.

## Validation (RED TEAM)
- `npm run lint`
- `npm run build`
- Manual checks:
  - Call `/api/cron/availability` twice quickly → second call should return `skipped: true` due to lock.
  - Seed many stale caches → confirm refresh prioritizes oldest (`staleAt` ascending) and does not starve.
  - Confirm metrics reflect staleness via `rangeStart` and surface `lastError` rates.

## Output
- **Starvation prevention**: Stale caches ordered by `staleAt: "asc"` (oldest first)
- **Time budget**: `getCronTimeBudgetMs()` with env var support (default 55s)
- **Concurrency**: Worker pool with configurable concurrency (auto-computed or env)
- **Advisory lock**: Postgres `pg_try_advisory_lock` prevents overlapping runs
- **Metrics correctness**: Uses `rangeStart` as proxy for successful refresh age

**Key Implementation Details:**
```typescript
// Time budget enforcement
const deadlineMs = startedAtMs + timeBudgetMs;
// ...
if (Date.now() > deadlineMs - 7_500) break; // Stop 7.5s before budget

// Worker pool with bounded concurrency
const workers = Array.from({ length: concurrency }, async () => {
  while (idx < queue.length) {
    if (Date.now() > deadlineMs - 7_500) break;
    // ... refresh workspace
  }
});
await Promise.all(workers);

// Staleness metrics via rangeStart (not fetchedAt)
const oldestSuccessfulRangeStartAgeMinutes = one?.rangeStart
  ? Math.round((now.getTime() - one.rangeStart.getTime()) / 60_000)
  : null;
```

**Status:** ✅ Complete (2026-01-27)

## Handoff
Update Phase 61 root success criteria evidence (metrics examples + manual proof points), then coordinate with Phase 59 on whether followups should stop refreshing availability.
