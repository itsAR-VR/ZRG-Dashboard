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
