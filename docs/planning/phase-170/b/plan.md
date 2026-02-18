# Phase 170b — Analytics Read-Path De-duplication + Query/Caching Hardening

## Focus
Reduce Analytics latency variance by removing duplicate request work and tightening cache/query contracts without changing functional behavior.

## Inputs
- `docs/planning/phase-170/a/plan.md`
- `app/api/analytics/*`
- `actions/analytics-actions.ts`
- `actions/response-timing-analytics-actions.ts`

## Work
1. Remove duplicate request work on analytics endpoints (auth/cache/query pass de-duplication).
2. Align cache invalidation/version semantics across route and action layers.
3. Reduce analytics endpoint fan-out where safe (shared context and consolidated access checks).
4. Tighten expensive query paths with explicit timeout/budget handling and deterministic fallbacks.
5. Add/extend lightweight observability fields needed for iteration scoring.

## Validation
- `npm run lint`
- `npm run build`
- `npm test`
- Endpoint smoke checks for overview/workflows/campaigns/response-timing/crm modes.

## Output
- Analytics latency and variance reduction patch set with before/after evidence in `docs/planning/phase-170/artifacts/analytics-pass.md`

## Handoff
Subphase c reuses the same de-duplication patterns for Inbox conversation and counts paths.
