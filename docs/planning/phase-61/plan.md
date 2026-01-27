# Phase 61 — Production-Grade Availability Cache Refresh

## Purpose
Harden the availability cache refresh system for production by adding staleness safeguards, global-concurrency refresh processing, and ensuring every workspace gets timely availability updates to prevent offering past dates to leads.

## Context
Investigation revealed that the current availability system has a critical bug: leads are being offered time slots from **last week** that are no longer available. Root cause analysis:

1. **Cache refresh throughput may still be too low**: `/api/cron/followups` refreshes availability for only 20 workspaces per run (env: `AVAILABILITY_CRON_LIMIT`) while some deployments can have ~1,000 workspaces.
2. **Potential starvation**: `refreshAvailabilityCachesDue()` selects stale caches without an explicit ordering, so the “oldest” caches may not be prioritized when the stale set is large.
3. **No hard filter for past dates**: If a cache contains old slots, they can leak into AI drafts and templates.
4. **Refresh failures can preserve old slots**: `refreshWorkspaceAvailabilityCache()` updates `fetchedAt/staleAt/lastError` on error, but does not clear `slotsUtc`, so “last known” slots can become stale and include past dates.
5. **No monitoring**: No visibility into cache staleness/error rates across workspaces.

### Current Architecture (Problem)
```
┌─────────────────────────────────────────────────────────┐
│ /api/cron/followups (* * * * *)                         │
│ ├─ refreshAvailabilityCachesDue({ limit: 20 })          │
│ └─ ... other follow-up processing                       │
└─────────────────────────────────────────────────────────┘
```

- **TTL**: 10 minutes (`CACHE_TTL_MS = 10 * 60 * 1000`)
- **Cron limit**: 20 workspaces per run (env: `AVAILABILITY_CRON_LIMIT`)
- **Cron schedule**: Every 1 minute (`* * * * *`) (Phase 59)
- **Max throughput**: 20 workspaces / 1 min = **20 workspaces/minute**

### Target Architecture (Solution)
```
┌─────────────────────────────────────────────────────────┐
│ /api/cron/availability (NEW - * * * * *)                │
│ ├─ refreshAvailabilityCachesDue({ /* time budget + concurrency */ }) │
│ └─ returns staleness + error metrics                    │
└─────────────────────────────────────────────────────────┘
```

- **Global concurrency**: single pool (shared across all workspaces)
- **Workspace selection**: prioritize stalest first; no starvation
- **Cron schedule**: Every 1 minute (`* * * * *`)
- **Dedicated endpoint**: Separate from follow-ups for independent scaling/monitoring
- **Important clarification**: any `limit` in this phase refers to *workspaces refreshed per cron run* (a safety bound), **not** “number of availability slots”. We do **not** cap the number of availability slots stored per workspace; we store all slots returned by the provider within our lookahead window.
- **TTL**: tighten the cache TTL (target: ~1 minute) and accept higher provider load; staleness is still bounded by time budget + global concurrency.
- **Lookahead window**: keep the existing 30‑day window (no change).

### Key Files
- `lib/availability-cache.ts` — Cache refresh logic, TTL, staleness check
- `lib/availability-distribution.ts` — Slot selection (has `>= now` filter)
- `app/api/cron/followups/route.ts` — Currently hosts availability refresh
- `app/api/cron/emailbison/availability-slot/route.ts` — EmailBison first-touch slot injection (depends on availability freshness)
- `vercel.json` — Cron schedules

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 59 | Active | `vercel.json`, `app/api/cron/followups/route.ts` | Followups cron cadence is already every minute; Phase 61 must coordinate to avoid double-refresh and calendar-provider rate-limit spikes |
| Phase 60 | Active | None | No overlap; booking UI documentation |
| Phase 55 | Complete | `vercel.json`, `app/api/cron/emailbison/availability-slot/route.ts`, `lib/emailbison-first-touch-availability.ts`, `lib/availability-cache.ts` | EmailBison cron calls `getWorkspaceAvailabilitySlotsUtc({ refreshIfStale: true })`; tightening TTL + adding new availability cron must avoid double-refresh thrash and provider spikes |

## Pre-Flight Conflict Check (Multi-Agent)

- Working tree has Phase 59 changes to `vercel.json` (followups cron now `* * * * *`)
- Files this phase will touch:
  - `lib/availability-cache.ts` — Add past-date filter, improve error handling
  - `app/api/cron/availability/route.ts` — **NEW** dedicated cron endpoint
  - `app/api/cron/followups/route.ts` — Stop upfront availability refresh (avoid double-refresh)
  - `vercel.json` — Add new cron entry
- Potential overlap with Phase 59 if it is also changing availability refresh behavior inside `/api/cron/followups`
- Pre-flight commands (run before implementation):
  - `git status --porcelain`
  - `ls -dt docs/planning/phase-* | head -10`
  - `git log -1 --oneline -- vercel.json app/api/cron/followups/route.ts app/api/cron/emailbison/availability-slot/route.ts lib/availability-cache.ts lib/emailbison-first-touch-availability.ts`

## Objectives
* [x] Create dedicated `/api/cron/availability` endpoint for cache refresh
* [x] Add global concurrency + time budget so refresh scales to large agencies (up to ~1,000 workspaces)
* [x] Ensure **every configured workspace** is refreshed every minute (multi-agency); do not rely on followups/emailbison paths for refresh
* [x] Tighten availability cache TTL (target: ~1 minute) and keep it configurable
* [x] Add hard filter in `getWorkspaceAvailabilitySlotsUtc()` to strip past dates
* [x] Add staleness + error metrics in cron response (oldest cache age, count of very stale/erroring caches)
* [x] Update `vercel.json` with new cron schedule (every minute)
* [x] Add logging when past slots are detected/stripped (cache safety net)
* [ ] Verify existing on-demand refresh (`refreshIfStale: true`) still works (manual smoke on deploy)
* [x] Prevent starvation by prioritizing the stalest caches first (explicit ordering)
* [x] Add a time budget and overlap protection for the new cron endpoint (avoid concurrent runs)
* [x] EmailBison first-touch slot injection uses cached availability + is configurable per workspace (UI)

## Constraints
- **Vercel cron limits**: Pro plan allows up to 10 cron jobs; we currently have 7
- **Function timeout**: Vercel Pro allows up to 800s; refreshing many workspaces must be time‑bounded and safe to run every minute
- **Calendar API rate limits**: Calendly/GHL/HubSpot have rate limits; high refresh volumes across many workspaces can hit limits
- **Cross-cron refresh pressure**: other crons (e.g., EmailBison first-touch) call `refreshIfStale: true` today; tightening TTL without coordination can multiply provider load
- **Multi-agency fairness**: this deployment hosts multiple agencies; refresh must be scoped/partitioned by the “white-label workspace” identifier (current repo reality: `Client.userId`) so one agency can’t starve others
- **No breaking changes**: On-demand refresh path must continue working for AI drafts
- **Cron overlap**: If the cron takes >60s, it can overlap with the next minute’s invocation; add an explicit lock + time budget

## Success Criteria
- [x] New `/api/cron/availability` endpoint refreshes enough workspaces per minute to keep cache staleness within SLA for large agencies (up to ~1,000 workspaces) — mode: "all" targets all configured workspaces per run; metrics expose attempted/refreshed/finishedWithinBudget
- [x] Past dates (< now) are filtered from `getWorkspaceAvailabilitySlotsUtc()` return value — implemented with logging when past slots stripped
- [x] Cache TTL tightened (target: ~1 minute) without breaking on-demand refresh — `getCacheTtlMs()` defaults to 60s, configurable via `AVAILABILITY_CACHE_TTL_MS`
- [ ] No workspace cache is >1 hour stale under normal operation (with ~1,000 workspaces) — requires production validation (provider latency/rate limits)
- [x] Cron response includes staleness + error metrics for monitoring — `metrics` object with totalCaches, dueCaches, erroringCaches, oldestSuccessfulRangeStartAgeMinutes
- [x] Refresh selection is fair (oldest caches refreshed first; no starvation under load) — `orderBy: { staleAt: "asc" }` + multi-agency interleaving by userId
- [x] Cron does not overlap (lock prevents concurrent runs; time budget keeps run < cadence) — Postgres advisory lock + 55s time budget
- [x] `npm run lint` passes
- [x] `npm run build` passes
- [ ] Manual test: verify stale cache gets refreshed within 1 minute (requires deploy)

## Subphase Index
* a — Add hard past-date filter to `getWorkspaceAvailabilitySlotsUtc()`
* b — Create dedicated `/api/cron/availability` endpoint
* c — Add staleness metrics and logging
* d — Update `vercel.json` and environment defaults
* e — Throughput hardening: ordering, time budget, overlap lock, and metric correctness
* f — Scale/config clarification and cross-cron coordination (no slot caps; avoid double-refresh)

## Repo Reality Check (RED TEAM)

### What exists today
- `lib/availability-cache.ts`:
  - `CACHE_TTL_MS = 10 * 60 * 1000` (10 min)
  - `refreshWorkspaceAvailabilityCache(clientId)` — fetches from calendar provider
  - `getWorkspaceAvailabilitySlotsUtc(clientId, opts)` — returns cached slots, filters booked
  - `refreshAvailabilityCachesDue({ limit })` — batch refresh stale caches
- `lib/availability-distribution.ts`:
  - `selectDistributedAvailabilitySlots()` — already filters `>= anchorMs` (line 61)
- `app/api/cron/followups/route.ts`:
  - Calls `refreshAvailabilityCachesDue({ limit: availabilityLimit })`
  - `availabilityLimit` defaults to 20 (env: `AVAILABILITY_CRON_LIMIT`)
- `vercel.json`:
  - 7 cron jobs currently configured
  - `/api/cron/followups` schedule (Phase 59 changed to `* * * * *`)

### What this plan assumes
- We can safely add an 8th cron job (within Vercel Pro limits)
- Calendar providers can handle the target refresh volume (may need rate limiting + concurrency control)
- Separating availability from followups is safe (no shared state concerns)

### Verified touch points (files + identifiers)
- `lib/availability-cache.ts`:
  - `refreshWorkspaceAvailabilityCache()`
  - `getWorkspaceAvailabilityCache()`
  - `getWorkspaceAvailabilitySlotsUtc()`
  - `refreshAvailabilityCachesDue()`
- `app/api/cron/followups/route.ts`:
  - `AVAILABILITY_CRON_LIMIT` parsing and `refreshAvailabilityCachesDue({ limit })`

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Past slots leak into prompts** (cache contains slots that are now in the past) → add a hard past-date filter in `getWorkspaceAvailabilitySlotsUtc()` and log when any past slots are stripped.
- **Starvation under load** (stale cache selection has no explicit ordering) → order stale-cache selection by oldest first (`staleAt` / “age”).
- **Cron overlap / thundering herd** (every-minute schedule + long refresh loop) → add time budget + overlap lock; ensure the endpoint returns cleanly before the next invocation.
- **Rate limit spiral** (high refresh volume across multiple providers) → add global concurrency limits/backoff and surface provider errors as metrics.
- **Double-refresh thrash** (multiple crons/paths refreshing the same caches) → stop upfront refresh in followups and decide whether EmailBison cron should keep `refreshIfStale: true` once dedicated availability cron is live.

### Observability gaps
- Using `fetchedAt` alone can be misleading on refresh failures (it is updated on error) → prefer a “last successful refresh” proxy (`rangeStart`) for staleness metrics, and count `lastError` rates separately.

### Testing / validation gaps
- No plan step to validate fairness under load → add a smoke check: seed >limit stale caches and confirm the oldest caches are refreshed first.

## Open Questions (Need Human Input)
- [x] Tighten TTL and accept higher provider load (resolved)
- [x] Keep 30‑day lookahead window (resolved)
- [x] Availability refresh SLA for large agencies: **every workspace refreshed every minute**. (resolved 2026-01-27)
  - Why it matters: we must tune concurrency + time budget so the cron can cover the full active workspace set each run (not just “oldest-first” best effort).
- [x] Multi-tenant scope: **multi-agency** deployment. Use the “white-label workspace” identifier for fairness; repo reality today suggests `Client.userId`. (resolved 2026-01-27)
  - Why it matters: we must ensure one agency can’t consume the entire refresh budget and starve others.
- [x] EmailBison first-touch should **rely on dedicated availability cron** (no `refreshIfStale` provider fetch from that path). (resolved 2026-01-27)
  - Why it matters: avoids duplicate provider load under a tight TTL and makes refresh responsibility explicit.

## Assumptions (Agent)

- Cron cadence: `/api/cron/followups` remains `* * * * *` during this phase (confidence ~90%)
  - Mitigation question/check: if followups cadence changes back to `*/10`, re-evaluate whether a separate availability cron is still needed vs just increasing the limit.
- Followups no longer refresh availability caches once `/api/cron/availability` is live (confidence ~90%)
  - Mitigation question/check: keep `refreshIfStale: true` call sites as a safety fallback, but remove the upfront `refreshAvailabilityCachesDue()` call from followups cron to avoid double-refresh load.
- Availability caches store **all** provider-returned slots within the 30-day lookahead window (no slot-count cap) (confidence ~95%)
  - Mitigation question/check: verify `fetchCalendlyAvailabilityWithMeta` / `fetchHubSpotAvailability` / `fetchGHLAvailabilityWithMeta` don’t apply implicit slot limits beyond the lookahead window.
- “White-label workspace” identifier maps to `Client.userId` (Supabase Auth user ID) in the current schema (confidence ~90%)
  - Mitigation question/check: if there is (or will be) a distinct agency/org identifier, switch partitioning to that field instead of `Client.userId`.

## Phase Summary

### Shipped (2026-01-27)
All subphases (61a–61f) implemented:

1. **Past-date filter** (`lib/availability-cache.ts:499-511`)
   - Defensive filter strips past dates before returning slots
   - Logs warning when past/bad slots removed

2. **Dedicated cron endpoint** (`app/api/cron/availability/route.ts`)
   - Postgres advisory lock prevents overlapping runs
   - Mode "all" targets all configured workspaces (attempted/refreshed bounded by time budget)
   - Configurable time budget (default 55s) and concurrency

3. **Staleness metrics** (`refreshAvailabilityCachesDue()` return type)
   - totalCaches, dueCaches, erroringCaches
   - oldestSuccessfulRangeStartAgeMinutes (uses rangeStart as proxy)
   - finishedWithinBudget boolean

4. **vercel.json updated**
   - New cron: `/api/cron/availability` at `* * * * *`
   - 8 total crons (within Vercel Pro limit of 10)

5. **Throughput hardening**
   - Oldest-first ordering (`staleAt: "asc"`)
   - Time budget enforcement (stops 7.5s before deadline)
   - Worker pool with bounded concurrency

6. **Multi-agency fairness**
   - Interleaving by `Client.userId` buckets
   - Prevents single agency from starving others

7. **Cache TTL tightened**
   - Default 60s (configurable via `AVAILABILITY_CACHE_TTL_MS`)
   - Backoff respected for permanent errors

8. **Followups cron updated**
   - No longer does upfront availability refresh
   - Availability handled by dedicated cron

9. **EmailBison first-touch injection controls (per workspace)**
   - `availability_slot` injection relies on cached availability (dedicated cron is source-of-truth)
   - WorkspaceSettings fields + settings UI “Preview current value” for `availability_slot`

### Files Changed
- `lib/availability-cache.ts` — Core refresh logic, metrics, past-date filter
- `app/api/cron/availability/route.ts` — NEW dedicated cron endpoint
- `app/api/cron/followups/route.ts` — Removed availability refresh
- `vercel.json` — Added availability cron entry
- `lib/emailbison-first-touch-availability.ts` — Use cached availability only + per-workspace controls
- `prisma/schema.prisma` — Add WorkspaceSettings fields for EmailBison `availability_slot` controls
- `actions/settings-actions.ts` — Plumb new settings fields
- `actions/emailbison-availability-slot-actions.ts` — Server action to preview the injected value in UI

### Verified
- `npm run db:push`: ✅ pass (2026-01-27T18:15:37+03:00) — database already in sync
- `npm run lint`: ✅ pass (2026-01-27T18:16:04+03:00) — 0 errors, 18 warnings
- `npm run build`: ✅ pass (2026-01-27T18:16:27+03:00)

### Remaining
- Deploy and verify manual test: stale cache refreshed within 1 minute
- Monitor staleness metrics in production

### Key Environment Variables
```bash
AVAILABILITY_CACHE_TTL_MS=60000      # Cache TTL (default: 1 minute)
AVAILABILITY_CRON_TIME_BUDGET_MS=55000  # Cron time budget (default: 55s)
AVAILABILITY_CRON_CONCURRENCY=       # Worker concurrency (auto-computed if not set)
```
