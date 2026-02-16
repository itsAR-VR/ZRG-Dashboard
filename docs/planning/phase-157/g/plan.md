# Phase 157g — Failure-Mode Drill + Auth/Rollback Verification

## Focus
Harden analytics rollout safety by validating failure behavior, auth boundaries, and rollback controls before full release.

## Inputs
- `docs/planning/phase-157/plan.md`
- `app/api/analytics/*`
- `lib/feature-flags.ts`
- Canary evidence packet from 157f

## Work
1. Run auth negative-case checks on analytics read routes (unauthenticated and unauthorized workspace access).
2. Validate rollback controls for analytics read-path flags in production-safe order.
3. Execute failure-mode drill:
   - cache miss bursts
   - temporary Redis/cache unavailability behavior
   - endpoint fallback/health behavior under repeated cold hits.
4. Confirm request-id and error payload observability quality for all tested failure modes.
5. Produce a concise go/no-go hardening addendum tied to rollout gates.

## Validation (RED TEAM)
- Route responses remain correct for 401/403/5xx classes.
- Rollback path can be executed without code changes.
- Failure-mode outcomes are documented with expected operator actions.

## Output
- Operational hardening addendum with:
  - `401` unauth evidence packet (`test-results/analytics-probe-unauth.json`)
  - authenticated latency packet (`test-results/analytics-probe-live-2026-02-16.json`)
  - authenticated `403` matrix evidence (invalid workspace UUID across analytics endpoints)
  - rollback control validation (flag semantics + disabled/enabled header behavior + Vercel env presence)
  - failure-mode burst drill evidence (no 5xx under repeated cold misses)
  - request-id observability evidence for success and error classes.

## Coordination Notes
- Phase overlap check (last 10 phases) found active analytics-adjacent work in Phase 158/159/162 on `actions/*` and response-timing domains.
- To avoid merge races, this subphase turn touched only:
  - `docs/planning/phase-157/*`
  - new rollback/read-api regression tests in `lib/__tests__/*`
- No concurrent agent changes were reverted; all updates were additive.

## Handoff
Use this subphase as the rollout hardening packet for Phase 157 closure. If production env-flag flip rehearsal is required by policy, execute the runbook in the root plan with operator approval; otherwise proceed to `phase-review`.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Performed unauthenticated negative-case verification across all analytics read routes via probe runner (`401` matrix).
  - Performed authenticated unauthorized-workspace verification using invalid workspace UUID (`00000000-0000-4000-8000-000000000000`) and confirmed all analytics read routes return `403`.
  - Executed live production cache-miss burst drill (`8` rounds across overview/workflows/campaigns/response-timing/crm rows) with unique windows; no `5xx` responses observed.
  - Verified rollback control surface exists in Vercel env (`ANALYTICS_READ_API_V1`, `INBOX_READ_API_V1` on Dev/Preview/Prod).
  - Captured authenticated live `8 cold + 8 warm` probe artifact (`test-results/analytics-probe-live-2026-02-16.json`): all analytics endpoints `200`, warm/cold p95 values below targets, request-id coverage `100%`.
  - Added CI-level rollback guard tests:
    - `lib/__tests__/feature-flags-read-api.test.ts`
    - `lib/__tests__/analytics-read-api-rollback-headers.test.ts`
  - Verified cache-unavailable fail-open behavior in `lib/redis.ts` by probing with Redis env vars removed (`redisGetJson`/`redisIncr` returned `null`, no throw).
- Commands run:
  - `node --import tsx scripts/analytics-canary-probe.ts --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --cold-samples 1 --warm-samples 1 --out test-results/analytics-probe-unauth.json` — pass.
  - `cat test-results/analytics-probe-unauth.json` — pass; verified `401` statuses + request IDs for all analytics endpoints.
  - `vercel env ls` — pass; confirmed read-API rollback flags are configured across all environments.
  - Playwright live eval (authenticated, `clientId=29156db4-e9bf-4e26-9cb8-2a75ae3d9384`, `8 cold + 8 warm`) — pass; generated `test-results/analytics-probe-live-2026-02-16.json` with `0` warm/cold failures.
  - Playwright live eval (authenticated, invalid workspace UUID) — pass; `403` across overview/workflows/campaigns/response-timing/crm rows.
  - Playwright live eval (burst drill, repeated cold misses) — pass; all endpoints `200`, zero `5xx`, request IDs present.
  - `node --import tsx --test lib/__tests__/analytics-read-api-rollback-headers.test.ts lib/__tests__/feature-flags-read-api.test.ts` — pass (6/6).
  - `npx eslint lib/__tests__/analytics-read-api-rollback-headers.test.ts lib/__tests__/feature-flags-read-api.test.ts` — pass.
  - `npm run typecheck` — pass.
  - `npx tsx` Redis fail-open probe (`lib/redis.ts`) — pass (`{ read: null, incr: null }` with env removed).
- Blockers:
  - No functional blockers remain for 157g evidence quality.
- Next concrete steps:
  - Mark Phase 157 rollout hardening complete and carry cache-hit tuning/flag-flip rehearsal as optional ops runbook tasks.
  - Continue with next planned phase execution.
