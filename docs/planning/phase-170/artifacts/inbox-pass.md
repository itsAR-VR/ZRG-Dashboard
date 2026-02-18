# Phase 170 Inbox Pass

## Targets
- `/api/inbox/counts` p95 `< 2.0s`
- `/api/inbox/conversations` p95 `< 3.0s`
- Email search p95 `< 2.0s`

## Validation Commands
- `npm run test:e2e -- e2e/inbox-perf.spec.mjs`
- `npm run probe:inbox -- --client-id <workspaceId> --samples 20 --out docs/planning/phase-170/artifacts/inbox-canary.json`
- `npm run probe:staged-load -- --client-id <workspaceId> --no-analytics --bands small:2:4,medium:6:4,large:12:4 --out docs/planning/phase-170/artifacts/load-checks.json`

## Status
- Read-path duplicate work reduced in conversations/counts flow.
- Probe run completed:
  - `npm run probe:inbox -- --base-url https://zrg-dashboard.vercel.app --client-id 00000000-0000-0000-0000-000000000000 --samples 4 --out docs/planning/phase-170/artifacts/inbox-canary.json`
  - `npm run probe:staged-load -- --base-url https://zrg-dashboard.vercel.app --client-id 00000000-0000-0000-0000-000000000000 --bands small:2:2,medium:4:2,large:6:2 --out docs/planning/phase-170/artifacts/load-checks.json`
- Current snapshot:
  - `/api/inbox/counts`: `200`, p95 `6ms` (probe) / p95 `1-18ms` (staged bands)
  - `/api/inbox/conversations`: `401` without authenticated session
- Unauthenticated `counts` endpoint spot-check returned a zeroed fail-open payload (no workspace data leakage observed in this run).
- Playwright perf canary execution result: `3 skipped` (no authenticated storage state in environment).
