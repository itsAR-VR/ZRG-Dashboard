# Phase 157e — Cache/Precompute Acceleration (Redis + Inngest Aggregates)

## Focus
Add precompute support for endpoints that still miss SLO after direct query optimization.

Decision lock: precompute implementation is table-backed (Postgres rollup table/materialized rollup shape) first; Redis-only aggregate blobs are not the primary path for this phase.

## Inputs
- Post-157c/d latency evidence
- `app/api/analytics/_helpers.ts`
- `lib/inngest/functions/*`
- Existing analytics cache versioning (`analytics:v1:ver:{clientId}`)

## Work
1. Identify endpoints still above warm/cold targets and quantify remaining gap.
2. Add optional derived aggregate path (for example daily workspace analytics rollups) for those hotspots.
3. Build Inngest-driven refresh/recompute schedule with idempotent writes.
4. Wire cache/version invalidation so derived data and read caches stay consistent.
5. Keep a runtime kill switch/fallback to live-query path.

## Validation (RED TEAM)
- Confirm precompute path returns equivalent business metrics vs live-query baseline.
- Validate recompute idempotency and stale-data handling.
- Verify fallback path works when precompute is disabled.

## Output
- Optional precompute acceleration path with guarded rollout.

## Handoff
Proceed to Phase 157f for full validation, rollout gates, and closure evidence.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Re-evaluated need for 157e precompute implementation against current evidence:
    - Existing route-level Redis/versioned cache is active (`x-zrg-cache` + `analytics:v1:ver:{clientId}` flow).
    - Recent backend optimizations landed in 157c reduced server-query latency risk without schema expansion.
  - Added deterministic canary evidence collector (`scripts/analytics-canary-probe.ts`) so the precompute go/no-go decision can be made from measured authenticated p95 data instead of assumptions.
- Commands run:
  - `rg -n "analytics:v1:ver|readAnalyticsRouteCache|writeAnalyticsRouteCache" app/api/analytics actions lib` — pass; confirmed current cache/invalidation path.
  - `node --import tsx scripts/analytics-canary-probe.ts ...` — pass (framework validation, unauth run).
- Blockers:
  - 157e implementation decision is gated by authenticated production canary packet (8 cold + 8 warm). Without that packet we cannot justify schema/rollup expansion.
- Next concrete steps:
  - If authenticated packet misses SLO, implement table-backed rollup path in this subphase.
  - If packet meets SLO, close 157e as intentionally skipped (no extra precompute debt added).
