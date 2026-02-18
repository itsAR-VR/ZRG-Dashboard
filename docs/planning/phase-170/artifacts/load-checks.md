# Phase 170 Load Checks

## Matrix
- `small`: `2` concurrent users, `4` requests/worker/endpoint
- `medium`: `6` concurrent users, `4` requests/worker/endpoint
- `large`: `12` concurrent users, `4` requests/worker/endpoint

## Commands
- `npm run probe:staged-load -- --client-id <workspaceId> --bands small:2:4,medium:6:4,large:12:4 --out docs/planning/phase-170/artifacts/load-checks.json`
- `npx playwright test e2e/inbox-perf.spec.mjs --workers=4 --repeat-each=3`

## Run Log
- 2026-02-18: Harness added (`scripts/staged-read-load-check.ts`).
- 2026-02-18: Executed
  - `npm run probe:staged-load -- --base-url https://zrg-dashboard.vercel.app --client-id 00000000-0000-0000-0000-000000000000 --bands small:2:2,medium:4:2,large:6:2 --out docs/planning/phase-170/artifacts/load-checks.json`
  - `E2E_USE_WEBSERVER=1 npm run test:e2e -- e2e/inbox-perf.spec.mjs e2e/settings-perf.spec.mjs`

## Latest Output Snapshot (`load-checks.json`)
- `small`:
  - `/api/inbox/counts`: success `100%`, p95 `1ms`
  - `/api/inbox/conversations`: success `0%`, status `401`
  - analytics endpoints: success `0%`, status `401`
- `medium`:
  - `/api/inbox/counts`: success `100%`, p95 `18ms`
  - `/api/inbox/conversations`: success `0%`, status `401`
  - analytics endpoints: success `0%`, status `401`
- `large`:
  - `/api/inbox/counts`: success `100%`, p95 `1ms`
  - `/api/inbox/conversations`: success `0%`, status `401`
  - analytics endpoints: success `0%`, status `401`

## Interpretation
- This execution confirms harness integrity and artifact generation.
- It does **not** satisfy Phase 170 closure criteria because the environment lacked authenticated workspace session inputs; analytics/inbox conversation checks were blocked by auth (`401`).
- Playwright perf specs executed and were skipped (`3 skipped`) for the same reason (no storage state/auth session provided).

## Current Status
- `load-checks.json`: generated.
- Phase-closure quality verdict: **pending authenticated rerun**.
