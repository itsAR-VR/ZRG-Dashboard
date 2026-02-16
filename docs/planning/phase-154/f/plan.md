# Phase 154f — Observability + Load/Latency Validation + Rollout Checklist

## Focus
Prove the architecture changes are correct, safe, and measurably faster. Add baseline observability and define a rollout path that avoids breaking production.

## Inputs
- New read APIs, KV caching, counts materialization, realtime invalidation, and queued jobs from prior subphases.
- Existing validation expectations in AGENTS.md.

## Work
1. Observability baseline:
   - Add structured logs for inbox read APIs:
     - request id, user id, client id, durationMs, cacheHit, row counts
   - Add error capture plan:
     - either integrate Sentry (preferred) or define a log-drain + alerting path (Vercel log drain).
2. Feature flag / rollout:
   - Gate UI read path switch with env flag (e.g., `INBOX_READ_API_V1=1`) for staged rollout.
   - Include a “fallback to legacy Server Actions” switch for emergency rollback.
3. Performance validation:
   - Measure p50/p95 latency for:
     - `/api/inbox/conversations` first page
     - `/api/inbox/counts`
   - Verify KV cache hit rate under steady state.
4. Quality gates:
   - `npm run lint`
   - `npm run typecheck`
   - `npm run build`
   - `npm test`
5. Required AI/message validation gates (NTTAN):
   - `npm run test:ai-drafts`
   - `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
   - `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`
6. Manual smoke checklist:
   - Switch workspaces rapidly; inbox stays responsive; no stuck spinner; no React #301.
   - Counts update without visible “60s polling stutter”.
   - Realtime disconnected path: slow fallback polling keeps data from going stale.

## Output
- A rollout checklist and evidence that the new architecture is faster and stable.
- Notes recorded in `docs/planning/phase-154/plan.md` (append a Phase Summary section when implemented).

## Handoff
If successful, proceed to implementation review (phase-review) and production verification on `https://zrg-dashboard-zrg.vercel.app`.

