# Phase 155d — Analytics Read Path Completion (GET APIs + Redis Cache + Chunking + Session Cache)

## Focus
Finish analytics migration to cache-friendly GET APIs and hit the production SLO (`p95 <1.5s warm`, `<3s cold`) using chunked loading and bounded local persistence.

## Inputs
- Current analytics UI in `components/dashboard/analytics-view.tsx`.
- Existing overview route: `app/api/analytics/overview/route.ts`.
- Analytics server actions in `actions/analytics-actions.ts`, `actions/response-timing-analytics-actions.ts`, and AI draft analytics actions.
- Upstash Redis helpers in `lib/redis.ts`.

## Work
1. **Create missing GET routes**
   - `GET /api/analytics/workflows`
   - `GET /api/analytics/campaigns`
   - `GET /api/analytics/response-timing`
   - `GET /api/analytics/crm/rows`
   - Extend `GET /api/analytics/overview` with `parts=core|breakdowns|all`.

2. **Server-runtime auth and access checks**
   - Verify session in each route.
   - Authorize `clientId` via workspace access helper.
   - Return explicit 401/403 payloads.

3. **Redis read-through caching**
   - Use user/workspace/window scoped keys with version suffix.
   - TTL targets:
     - overview core/breakdowns: 120s
     - workflows/campaigns/response timing: 120s
     - CRM rows pages: 30-60s
   - Invalidate by version bump:
     - `analytics:v1:ver:{clientId}`.

4. **Client chunking and fan-out control**
   - Overview loads `parts=core` first, then `parts=breakdowns`.
   - Only fetch active tab data on mount.
   - Lazy fetch on tab switch with stale-while-refresh UX.

5. **Bounded sessionStorage cache**
   - Key by `userId + clientId + tab + parts`.
   - TTL 10 minutes.
   - LRU cap 20 entries.
   - Use stale-fast render then background refresh.

6. **SLO measurement**
   - Add per-endpoint latency metric tags for warm/cold cache.
   - Validate p95 against targets before full rollout.
   - If SLO misses persist, enable optional derived aggregate table path.

## Validation
- All analytics tabs load through GET APIs.
- No cross-tenant data leakage in cache or route auth.
- p95 warm and cold latency targets achieved in canary.
- Tab switch perceived load materially improved by local cache and chunking.

## Output
- Analytics read path is GET + Redis-backed + progressively rendered.
- SLO measurement is wired and actionable.

## Handoff
Proceed to Phase 155e for durable Inngest orchestration and queue reliability.

## Output (2026-02-16)
- Added missing analytics GET read routes:
  - `app/api/analytics/workflows/route.ts`
  - `app/api/analytics/campaigns/route.ts`
  - `app/api/analytics/response-timing/route.ts`
  - `app/api/analytics/crm/rows/route.ts` (supports `mode=rows|summary|assignees`)
- Added per-route cache policy headers (`private, max-age, stale-while-revalidate`) to make read routes cacheable in-browser while preserving authenticated isolation.
- Added Redis read-through route caching with user/client/version scoped keys for non-overview analytics endpoints:
  - `workflows`, `campaigns`, `response-timing`, and CRM `rows|summary|assignees`
  - Cache key shape now includes `userId`, `clientId`, endpoint, normalized params, and `analytics:v1:ver:{clientId}`.
- Added analytics version bump invalidation hook to dirty-mark path:
  - `lib/inbox-counts-dirty.ts` now increments `analytics:v1:ver:{clientId}` when workspace data is marked dirty.
- Added shared route helpers for consistent flag/error/header behavior:
  - `app/api/analytics/_helpers.ts`
- Extended existing overview route to accept `parts` query parameter contract (`core|breakdowns|all`) and return read-path headers:
  - `app/api/analytics/overview/route.ts`
- Migrated analytics client read paths to API-first with fail-open fallback to legacy server actions when `READ_API_DISABLED` is set:
  - `components/dashboard/analytics-view.tsx`
  - `components/dashboard/analytics-crm-table.tsx`
- Implemented bounded sessionStorage cache in analytics client with stale-fast hydration + background refresh:
  - Key contract: `zrg:analytics:{userId}:{clientId}:{tab}:{parts}`
  - TTL: 10 minutes
  - LRU cap: 20 entries
  - Applied to tabs: `overview`, `workflows`, `campaigns`, `response-timing`
- Implemented true split-query overview read path:
  - `GET /api/analytics/overview?parts=core` computes and returns KPI/core overview payload
  - `GET /api/analytics/overview?parts=breakdowns` computes and returns breakdown-heavy sections
  - Route cache keys now include `parts` and are versioned by `analytics:v1:ver:{clientId}`
  - Client overview tab now requests `core` first, then `breakdowns` in background and merges result
- Added endpoint-level latency trace header for canary measurement:
  - `x-zrg-duration-ms` now emitted on successful responses from:
    - `/api/analytics/overview`
    - `/api/analytics/workflows`
    - `/api/analytics/campaigns`
    - `/api/analytics/response-timing`
    - `/api/analytics/crm/rows`
- Kept write path unchanged (`updateCrmSheetCell` stays a Server Action).

## Validation Evidence
- `npm run typecheck` ✅
- `npm run lint` ✅ (warnings only; no errors)
- `npm run build` ✅
- Build artifact includes new routes:
  - `/api/analytics/workflows`
  - `/api/analytics/campaigns`
  - `/api/analytics/response-timing`
  - `/api/analytics/crm/rows`

## RED TEAM Pass (post-implementation)
- Closed:
  - Analytics tabs are no longer action-only on the client; they now use cacheable GET read endpoints with runtime kill-switch fallback.
  - CRM analytics table reads (rows/summary/assignees) are now route-based and no longer hard-bound to direct server action reads.
  - Non-overview endpoints now use versioned Redis read-through caching and emit cache-hit/miss headers for verification.
  - Analytics client now persists bounded per-tab session cache and hydrates stale-fast before background refresh.
- Remaining gaps to fully satisfy 155d SLO objectives:
  - Canary p95 warm/cold evidence packet is still pending production metrics capture.

## Incident Addendum (2026-02-16)
- Production analytics SLO validation is currently blocked by read-path gating outage, not query latency:
  - Jam evidence shows `GET /api/analytics/*` returning `503` with body `{ "success": false, "error": "READ_API_DISABLED" }`.
  - Response headers include `x-zrg-read-api-enabled: 0` and `x-zrg-cache: MISS`.
  - Evidence links:
    - `https://jam.dev/c/ab6733e6-9088-45b8-bedd-c8657b534d76`
    - `https://jam.dev/c/a87e4cbb-8c33-4cf6-a3de-08cce131b652`
- Operational observation:
  - Probe runs that used `clientId=<workspace-id>` placeholder are not valid for latency benchmarking.
  - Even with invalid `clientId`, expected behavior should still be auth/validation errors, not global `READ_API_DISABLED`.

## Immediate Recovery Steps (must complete before p95 packet)
1. Re-enable read APIs in production runtime env and redeploy:
   - `NEXT_PUBLIC_ANALYTICS_READ_API_V1=true`
   - `NEXT_PUBLIC_INBOX_READ_API_V1=true`
2. Validate endpoint health post-deploy:
   - `/api/analytics/overview`
   - `/api/analytics/workflows`
   - `/api/analytics/campaigns`
   - `/api/analytics/response-timing`
   - `/api/analytics/crm/rows`
   - Expect `x-zrg-read-api-enabled: 1`, 200 response, and `x-zrg-duration-ms` present.
3. Re-run warm/cold p95 probe with a real workspace id (UUID), not placeholder text.
4. Capture and append evidence packet for 155d SLO closure.

## Hardening Follow-Up (post-recovery)
- Update `lib/feature-flags.ts` so production defaults are fail-open for read APIs when envs are missing, with explicit env value required to disable.
- Add server-env precedence (`ANALYTICS_READ_API_V1`, `INBOX_READ_API_V1`) while keeping `NEXT_PUBLIC_*` compatibility during migration.
- Add alerting on sustained `READ_API_DISABLED` response volume to prevent silent recurrence.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added helper-level Redis cache primitives for analytics routes (`getAnalyticsCacheVersion`, scoped key builder, read/write helpers).
  - Applied user-scoped + versioned read-through caching to:
    - `app/api/analytics/workflows/route.ts`
    - `app/api/analytics/campaigns/route.ts`
    - `app/api/analytics/response-timing/route.ts`
    - `app/api/analytics/crm/rows/route.ts`
  - Added route cache observability headers (`x-zrg-cache: hit|miss`) on cacheable read routes.
  - Wired analytics version invalidation into dirty-mark writes (`lib/inbox-counts-dirty.ts`).
  - Multi-agent coordination: scanned phases 147-156 for overlaps; `phase-156` mentions `inbox-view` settings CTA only, no direct overlap with analytics API/cache files touched this turn.
- Commands run:
  - `npm run typecheck` — pass.
  - `npm run lint` — pass (warnings only, pre-existing).
  - `npm run build` — pass.
  - `git status --porcelain` — pass; mixed-agent working tree remains intact.
  - `ls docs/planning | rg '^phase-' | sort -V | tail -n 10` — pass; overlap scan completed.
- Blockers:
  - No local blocker for code changes; canary p95 evidence still requires production metrics access.
- Next concrete steps:
  - (Completed in later turns) sessionStorage LRU cache contract in analytics client.
  - (Completed in later turns) overview split-query behavior for `parts=core|breakdowns`.
  - Add p95 warm/cold instrumentation packet hooks for rollout verification.

## Progress This Turn (Terminus Maximus - Session Cache)
- Work done:
  - Wired session cache keys per tab/window/filter scope using `sessionUserId + clientId + tab + parts`.
  - Added stale-fast hydration from sessionStorage for `overview`, `workflows`, `campaigns`, and `response-timing`.
  - Added background refresh behavior that avoids loader flicker when session cache is present.
  - Added bounded LRU writes via shared index key and preserved per-tab in-memory short TTL behavior.
- Commands run:
  - `npm run typecheck` — pass.
  - `npm run lint` — pass (warnings only, pre-existing).
  - `npm run build` — pass.
- Blockers:
  - No local blocker at that point; query-splitting completed in a later turn, leaving p95 evidence capture.
- Next concrete steps:
  - (Completed in later turns) split overview computation into true `core` and `breakdowns` query paths.
  - Capture canary p95 warm/cold evidence packet and compare against SLO thresholds.

## Progress This Turn (Terminus Maximus - Overview Split)
- Work done:
  - Updated `getAnalytics` to support `parts: all|core|breakdowns` with part-scoped cache keys.
  - Added conditional query execution so `core` avoids breakdown-heavy queries and `breakdowns` avoids core/KPI query work.
  - Upgraded overview GET route to:
    - auth user upfront for scoped route cache keys
    - cache/read/write by `userId + clientId + window + parts + analytics version`
    - expose `x-zrg-cache` + `x-zrg-analytics-parts` headers
  - Updated analytics overview client flow to:
    - hydrate from session cache (`core` + `breakdowns` keys)
    - fetch `parts=core` first
    - fetch `parts=breakdowns` second and merge into existing overview state
- Commands run:
  - `npm run typecheck` — pass.
  - `npm run lint` — pass (warnings only, pre-existing).
  - `npm run build` — pass.
- Blockers:
  - No local blocker; only rollout evidence capture remains for 155d closure.
- Next concrete steps:
  - Capture production p95 warm/cold endpoint latency evidence and append to 155d packet.

## Progress This Turn (Terminus Maximus - Latency Headers)
- Work done:
  - Added shared helper `attachAnalyticsTimingHeader` to stamp response duration in milliseconds.
  - Wired `x-zrg-duration-ms` header into all analytics GET read routes on cache hit/miss success responses.
  - Preserved existing cache/read headers and auth behavior.
- Commands run:
  - `npm run typecheck` — pass.
  - `npm run lint` — pass (warnings only, pre-existing).
  - `npm run build` — pass.
- Blockers:
  - No code blocker; production canary measurements are now required to close the SLO evidence gap.
- Next concrete steps:
  - Capture p95 warm/cold evidence using `x-zrg-duration-ms` + `x-zrg-cache` from production canary traffic.
