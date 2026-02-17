# Phase 165e — Validation, Canary Rollout, and Rollback Readiness

## Focus
Prove the replacement is robust in production-like conditions, then roll out safely with explicit stop gates and rollback controls.

## Inputs
- Outputs from 165a–165d
- Existing canary/perf evidence patterns in recent phases (`phase-163`, `phase-164`)
- Runtime flags and deployment controls

## Work
- Run validation gates:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
  - `npm test`
  - `npm run test:ai-drafts`
  - `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
  - `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`
- Execute canary rollout stages (e.g., 5% → 25% → 100%) with hold windows and explicit stop criteria:
  - enqueue failures,
  - duplicate dispatch detections,
  - queue lag/backlog growth,
  - user-facing timeout/error regression.
- Verify production operational signals:
  - dispatch response latency,
  - run success/failure rates,
  - dead-letter volume,
  - median/p95 processing time by job type.
- Finalize rollback readiness:
  - fast disable/cutback path,
  - emergency inline mode policy (time-bounded),
  - operator runbook.

## Output
- Evidence packet proving robust Inngest-first replacement behavior and a production-ready rollback/runbook package.

## Handoff
If residual risk remains (e.g., DB hot spots or job-type-specific outliers), open Phase 166 for targeted optimization only.
