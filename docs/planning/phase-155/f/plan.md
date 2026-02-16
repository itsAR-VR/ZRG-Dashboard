# Phase 155f — React #301 Closure + Enterprise Observability + Release Sign-Off

## Focus
Eliminate remaining workspace-switch render loops, lock release regression coverage, and enforce production release blockers before 100% rollout.

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

3. **In-phase observability baseline**
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
   - Defer external error platform wiring (for example Sentry) to a follow-up phase; not a 155 release gate.

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

## Hard Release Blockers (Phase 155)
- Workspace switching does not trigger React #301 and does not enter persistent inbox error state.
- Read API health is restored in production (`x-zrg-read-api-enabled: 1`) with no sustained `READ_API_DISABLED` outages.
- Analytics p95 packet is captured using real workspace IDs and meets warm/cold targets from route timing headers.

## Validation
- React #301 is not reproducible under rapid workspace switching.
- Request IDs appear end-to-end in logs and correlated traces.
- Required latency/error/queue metrics are visible on dashboard.
- Phase 153 hard blockers are all clear.

## Output
- Workspace switch path is stable and regression-protected.
- Enterprise observability baseline is active.
- Production rollout sign-off is evidence-backed.

## Handoff
Close Phase 155 with verification packet: shipped items, SLO evidence, and rollback levers.

## Output (2026-02-16)
- Added production-safe read API runtime hardening in `lib/feature-flags.ts`:
  - Server env precedence: `INBOX_READ_API_V1` / `ANALYTICS_READ_API_V1`.
  - Backward-compatible fallback to `NEXT_PUBLIC_INBOX_READ_API_V1` / `NEXT_PUBLIC_ANALYTICS_READ_API_V1`.
  - Fail-open default in production runtime when flags are unset (explicit disable still supported via env).
- Added structured disabled-path telemetry + diagnostics headers for analytics read routes:
  - `x-zrg-read-api-reason=disabled_by_flag`
  - `x-request-id` on success/error/disabled responses
  - structured `console.warn` event payloads when read routes are disabled by flag
  - files: `app/api/analytics/_helpers.ts`, `app/api/analytics/*/route.ts`
- Added matching disabled-path diagnostics for inbox read routes:
  - `x-zrg-read-api-reason=disabled_by_flag`
  - `x-request-id` propagation
  - structured disabled events for counts/conversations endpoints
  - files: `app/api/inbox/counts/route.ts`, `app/api/inbox/conversations/route.ts`, `app/api/inbox/conversations/[leadId]/route.ts`
- Added workspace-switch regression harness scaffolding:
  - Stable selectors for workspace switch and inbox crash/error assertions:
    - `components/dashboard/sidebar.tsx`
    - `components/dashboard/inbox-view.tsx`
    - `components/dashboard/dashboard-error-boundary.tsx`
  - Playwright harness files:
    - `playwright.config.mjs`
    - `e2e/workspace-switch.spec.mjs`
  - Package scripts:
    - `test:e2e`
    - `test:e2e:headed`
  - Assertion coverage in spec:
    - workspace `clientId` URL persistence on switch
    - absence of dashboard error boundary
    - absence of persistent inbox error state
    - absence of React #301 / re-render crash console signals

## Validation Evidence
- `npm run typecheck` ✅
- `npm run lint` ✅ (warnings only; no errors)
- `npm run build` ✅
- `npm test` ✅ (`tests: 384`, `pass: 384`, `fail: 0`)
- `npm run test:e2e -- --list` ⚠️ blocked in sandbox (`ENOTFOUND registry.npmjs.org` while resolving `playwright` via `npx`)

## RED TEAM Pass (2026-02-16)
- Closed/mitigated this turn:
  - Read API global outage mode caused by env drift + fail-closed defaults is mitigated in code via production-safe defaults.
  - Read-path outage diagnostics are now observable via reason + request ID headers and structured disabled logs.
- Remaining weak spots:
  - Request-ID propagation is implemented on inbox/analytics read APIs but not yet standardized across all API routes/workers.
  - Workspace-switch E2E coverage now exists in-repo, but execution is pending an environment with Playwright installed and an authenticated dashboard session.
  - Production p95 evidence packet remains blocked until read APIs are confirmed re-enabled on deployed runtime env.

## Multi-Agent Coordination
- `git status --porcelain` showed ongoing multi-agent edits in Phase 155 files and Phase 156 plan creation.
- Files touched this turn overlap with prior 155a/155d work (`lib/feature-flags.ts`, `app/api/analytics/*`, `app/api/inbox/*`).
- Conflict handling:
  - Changes were surgical and limited to runtime flag semantics + headers/logging.
  - No settings IA (`phase-156`) files were modified.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented production-safe read API flag resolution with server-env precedence in `lib/feature-flags.ts`.
  - Added request-id and disabled-reason diagnostics across analytics and inbox read routes.
  - Added structured disabled-route log events to support incident triage and rollout gates.
- Commands run:
  - `npm run typecheck` — pass.
  - `npm run lint` — pass (warnings only).
  - `npm run build` — pass.
  - `npm test` — pass (384/384).
- Blockers:
  - Production canary verification requires deployment/env operations outside local repo edits.
- Next concrete steps:
  - Re-enable read API envs in production runtime and redeploy.
  - Capture warm/cold p95 packet (`x-zrg-duration-ms`, `x-zrg-cache`) from deployed app.
  - Run `npm run test:e2e` in CI or a network-enabled environment with authenticated storage state to produce executable workspace-switch evidence.
  - Finish Phase 155f observability scope: broader request-ID/log standardization.
