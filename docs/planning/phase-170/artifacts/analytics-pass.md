# Phase 170 Analytics Pass

## Targets
- Warm p95 `< 1.5s`
- Cold p95 `< 3.0s`

## Validation Commands
- `npm run probe:analytics -- --client-id <workspaceId> --out docs/planning/phase-170/artifacts/analytics-canary.json`
- `npm run lint`
- `npm run build`
- `npm test`

## Status
- Code-level route/cache hardening landed.
- Probe run completed:
  - `npm run probe:analytics -- --base-url https://zrg-dashboard.vercel.app --client-id 00000000-0000-0000-0000-000000000000 --cold-samples 2 --warm-samples 2 --out docs/planning/phase-170/artifacts/analytics-canary.json`
- Current output shows `401` across analytics endpoints (no authenticated session/cookie in this environment), so p95 closure is still pending authenticated rerun.
