# Phase 155f — React #301 Closure + Enterprise Observability + Release Sign-Off

## Focus
Eliminate remaining workspace-switch render loops, install enterprise observability baselines, and enforce production release blockers before 100% rollout.

## Inputs
- Current crash capture from dashboard error boundary.
- Workspace switching surfaces:
  - `components/dashboard/dashboard-shell.tsx`
  - `components/dashboard/inbox-view.tsx`
  - `components/dashboard/sidebar.tsx`
- Prior hardening constraints from phases 149/152/153.

## Work
1. **Render-loop instrumentation**
   - Add debug-gated render counter hook.
   - Instrument shell, inbox, and sidebar boundaries.
   - Emit loop warnings with context payload when render count exceeds threshold.

2. **Loop trigger audits**
   - Remove any state updates in render.
   - Consolidate/guard workspace-change effects.
   - Keep query keys primitive and stable.
   - Ensure realtime callbacks perform invalidation only.

3. **Enterprise observability baseline**
   - Wire `@sentry/nextjs` for client + server capture.
   - Add request ID propagation from edge/request entry to logs.
   - Standardize structured logs for API routes and workers:
     - `requestId`
     - `userId`
     - `clientId`
     - `route`
     - `latencyMs`
     - `cacheHit`
     - `result`
   - Add baseline metrics:
     - inbox fetch latency
     - analytics fetch latency
     - queue depth
     - queue retry/failure counts
     - webhook lag

4. **Regression protection**
   - Add workspace-switch E2E test (production-build profile) asserting:
     - no error-boundary activation
     - no persistent spinner
     - expected URL/clientId persistence
   - Add canary smoke checklist for manual verification.

5. **Phase 153 parity as hard blocker**
   - Block release on:
     - stacked layout regressions
     - stuck spinner regressions
     - URL persistence regressions

6. **Final release checks**
   - Run full gates:
     - lint, typecheck, build, test
     - AI smoke gates (`test:ai-drafts`, `test:ai-replay` runs)
   - Review canary metrics and error trends.
   - Approve 100% rollout only when all gates are green.

## Validation
- React #301 is not reproducible under rapid workspace switching.
- Sentry captures synthetic test exceptions in preview and production.
- Request IDs appear end-to-end in logs and correlated traces.
- Required latency/error/queue metrics are visible on dashboard.
- Phase 153 hard blockers are all clear.

## Output
- Workspace switch path is stable and regression-protected.
- Enterprise observability baseline is active.
- Production rollout sign-off is evidence-backed.

## Handoff
Close Phase 155 with verification packet: shipped items, SLO evidence, and rollback levers.
