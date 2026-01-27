# Phase 61f — Scale/Config Clarification and Cross-Cron Coordination

## Focus
Lock the scaling model for large agencies (up to ~1,000 workspaces) and remove ambiguity around “limits” by:
1) confirming we do **not** cap stored slot counts (we store all provider-returned slots within the 30‑day lookahead),
2) clarifying that `AVAILABILITY_CRON_LIMIT` is a **workspace-per-run** safety bound (not “slots”),
3) ensuring config/env parsing supports large agencies (and `0` where we intend “disable”),
4) coordinating other cron/job call sites so we don’t double-refresh providers when TTL is tight.

## Inputs
- `lib/availability-cache.ts`
  - `DEFAULT_LOOKAHEAD_DAYS`, `CACHE_TTL_MS`
  - `refreshWorkspaceAvailabilityCache()`
  - `getWorkspaceAvailabilitySlotsUtc()`
  - `refreshAvailabilityCachesDue()`
- `lib/calendar-availability.ts`
  - `fetchCalendlyAvailabilityWithMeta()`
  - `fetchHubSpotAvailability()`
  - `fetchGHLAvailabilityWithMeta()`
- Cron routes:
  - `app/api/cron/availability/route.ts` (Phase 61b)
  - `app/api/cron/followups/route.ts` (Phase 59/61 coordination)
  - `app/api/cron/emailbison/availability-slot/route.ts` (Phase 55)
- EmailBison first-touch processor:
  - `lib/emailbison-first-touch-availability.ts`
- `vercel.json` cron schedules

## Work

### 1) Verify “no slot cap” end-to-end
- Confirm the provider fetch layer returns all availability slots for the lookahead window (no implicit `slice()` / fixed “top N” truncation):
  - `fetchCalendlyAvailabilityWithMeta()` parses all `days[].spots[]`.
  - `fetchHubSpotAvailability()` iterates needed months and parses all returned `availabilities`.
  - `fetchGHLAvailabilityWithMeta()` parses all returned day slots.
- Confirm the cache persists the full slot list:
  - `refreshWorkspaceAvailabilityCache()` writes all `slotsUtc` (deduped + sorted), without truncation.
- Confirm any “limits” elsewhere are **presentation** only (prompt formatting / display), not storage.

### 2) Make workspace limit semantics unambiguous
- Keep the existing env var name for backward compatibility, but reduce future confusion:
  - Document explicitly: `AVAILABILITY_CRON_LIMIT` = max **workspaces** to refresh per cron run.
  - (Optional) Add a clearer alias like `AVAILABILITY_CRON_WORKSPACE_LIMIT` with fallback to the legacy name.
- Ensure parsing supports large agencies:
  - Avoid an artificial low max (e.g., 500) if we expect ~1,000+ workspaces.
  - Prefer: time budget + concurrency as the real safety rails; `limit` is secondary.

### 3) Coordinate refresh responsibilities across crons
- **Followups cron**: allow `AVAILABILITY_CRON_LIMIT=0` (disable) once `/api/cron/availability` is live to avoid double-refresh.
- **EmailBison first-touch cron (Phase 55)**:
  - Decide whether to keep `getWorkspaceAvailabilitySlotsUtc({ refreshIfStale: true })` as a resilience fallback.
  - If TTL is ~1 minute and availability cron is stable, consider switching to `refreshIfStale: false` (or gating with a separate env) to reduce provider load spikes.

### 4) Validation + rollout checklist
- Confirm cron overlap protection exists where needed (preferred: advisory lock on `/api/cron/availability`).
- Smoke-test at scale (local/dev DB seed or staging):
  - Create many stale caches; confirm oldest-first ordering and no starvation.
  - Confirm availability cron + EmailBison cron do not create provider thundering herd under tight TTL.

## Validation (RED TEAM)
- `rg -n "slice\\(0," lib/calendar-availability.ts lib/availability-cache.ts` should show no truncation in provider fetch + cache write paths.
- After implementation: `npm run lint` and `npm run build`.
- Manual: hit `/api/cron/availability` twice quickly → second run should return `skipped: true` due to lock.

## Output
- **No slot-count cap**: Verified - all provider-returned slots within lookahead stored
- **Workspace-per-run semantics**: Explicit in docs and code
- **Multi-agency fairness**: Interleaving by `Client.userId` buckets (lines 631-669):
  ```typescript
  // Multi-agency fairness: interleave workspaces across userId buckets
  const byUserId = new Map<string, Array<{...}>>();
  // ... round-robin across agencies
  ```
- **Followups coordination**: No longer does upfront refresh (comment on lines 48-49)
- **Mode "all"**: `/api/cron/availability` uses `mode: "all"` to process all configured workspaces
- **Configurable TTL**: `AVAILABILITY_CACHE_TTL_MS` defaults to 60s (1 minute freshness)
- **Backoff respected**: `shouldRespectBackoff()` prevents thrashing on permanent errors

**Verification:**
- `npm run lint`: ✅ (warnings only)
- `npm run build`: ✅
- No truncation in provider fetch: Verified (no `slice()` in storage path)

**Status:** ✅ Complete (2026-01-27)

## Handoff
Phase 61 complete. All subphases implemented. Deploy and monitor staleness metrics.

