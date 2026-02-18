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
- Validation packet (current turn):
  - `npm run lint` — pass (warnings only; no errors)
  - `npm run typecheck` — pass
  - `npm run build` — pass
  - `npm test` — pass (`401/401`)
  - `npm run test:ai-drafts` — pass (`76/76`)
  - replay dry/live (`--client-id ... --limit 20`) — blocked by DB connectivity preflight from this environment
    - artifacts:
      - `.artifacts/ai-replay/run-2026-02-17T21-52-26-180Z.json`
      - `.artifacts/ai-replay/run-2026-02-17T21-52-30-831Z.json`
- Rollout/cutback controls finalized in code + env contract:
  - steady-state dispatch mode: auto when `INNGEST_EVENT_KEY` is configured (or force with `BACKGROUND_JOBS_USE_INNGEST=true`)
  - force inline rollback: `BACKGROUND_JOBS_FORCE_INLINE=true`
  - emergency enqueue-failure fallback: `BACKGROUND_JOBS_INLINE_EMERGENCY_FALLBACK=true` (time-bounded only)
  - dispatch dedupe window tuning: `BACKGROUND_JOBS_DISPATCH_WINDOW_SECONDS`
- Multi-agent coordination status:
  - scanned last 10 phases and confirmed active overlaps in phases `167/168` are mainly inbox/webhook/analytics paths,
  - phase 165 edits remained scoped to background dispatch + Inngest + Prisma reliability schema.

## Handoff
Phase 165 remains implementation-complete but validation-partial until replay preflight can run from reachable network path. Re-run blocked replay commands and append evidence; if clean, move to review/closure.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Completed code-level cutover and durable reliability model for phase 165.
  - Ran full local quality gates and captured NTTAN replay blockers with artifacts.
  - Added explicit rollout/rollback controls to README and env contract.
- Commands run:
  - `npm run lint` — pass (warnings only).
  - `npm run typecheck` — pass.
  - `npm run build` — pass.
  - `npm test` — pass.
  - `npm run test:ai-drafts` — pass.
  - replay dry/live fallback commands — blocked by DB connectivity preflight.
- Blockers:
  - Supabase connectivity for replay preflight in this environment.
- Next concrete steps:
  - Re-run replay dry/live from an environment with DB reachability.
  - Run post-deploy canary checks on dispatch outcomes and duplicate suppression counters.
