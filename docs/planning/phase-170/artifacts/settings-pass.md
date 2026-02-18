# Phase 170 Settings Pass

## Targets
- Initial settings load p95 `< 2.5s`
- No heavy knowledge-asset body hydration on non-AI tabs
- Deferred integrations/booking slices load only on-demand

## Validation Commands
- `npm run test:e2e -- e2e/settings-perf.spec.mjs`
- `npm run lint`
- `npm run build`
- `npm test`

## Status
- Initial settings bootstrap now removes one redundant admin-status action call.
- Calendar links are fetched in parallel with the initial settings bootstrap call.
- New settings perf canary spec added (`e2e/settings-perf.spec.mjs`).
- Playwright settings perf canary executed with webserver mode:
  - `E2E_USE_WEBSERVER=1 npm run test:e2e -- e2e/settings-perf.spec.mjs`
  - Result: skipped due missing authenticated storage state/session in environment.
- Authenticated p95 capture is still pending.
