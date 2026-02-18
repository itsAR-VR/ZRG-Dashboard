# Phase 170 Observability Packet

## Scope
- Analytics read APIs
- Inbox read APIs
- Settings initial load path

## Required Evidence
- Endpoint latency histograms (`p50`, `p95`, `max`)
- Status code distribution
- Error-rate trend notes by run band (`small`, `medium`, `large`)
- Explicit pass/fail against Phase 170 success criteria

## Inputs
- `docs/planning/phase-170/artifacts/analytics-canary.json`
- `docs/planning/phase-170/artifacts/inbox-canary.json`
- `docs/planning/phase-170/artifacts/load-checks.json`
- Playwright perf specs:
  - `e2e/inbox-perf.spec.mjs`
  - `e2e/settings-perf.spec.mjs`

## Status
- Template created on 2026-02-18.
- Initial artifacts generated:
  - `analytics-canary.json` (current run: analytics endpoints returned `401` without auth)
  - `inbox-canary.json` (`/api/inbox/counts` returned `200`; `/api/inbox/conversations` returned `401` without auth)
  - `load-checks.json` (staged matrix executed; analytics/inbox conversation bands blocked by `401`)
- Playwright perf specs executed and skipped (`3 skipped`) due missing authenticated storage state.
- Final packet completion still requires authenticated rerun for production-meaningful p95 closure.
