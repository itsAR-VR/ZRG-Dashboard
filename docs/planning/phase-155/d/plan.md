# Phase 155d — Analytics Read Path Completion (GET APIs + Redis Cache + Chunking + Session Persistence)

## Focus
Make Analytics feel fast and scale under concurrency by moving reads to GET endpoints with Redis caching, chunking the UI so core KPIs render first, and adding bounded sessionStorage persistence.

## Inputs
- Analytics UI: `components/dashboard/analytics-view.tsx`
- Server Actions:
  - `actions/analytics-actions.ts`
  - `actions/response-timing-analytics-actions.ts`
  - `actions/ai-draft-response-analytics-actions.ts`
- Existing GET endpoint: `GET /api/analytics/overview`
- Redis helper: `lib/redis.ts`
- UX decision: require workspace (no `clientId=null` analytics)

## Work
1. Define GET read endpoints (read-only)
   - `GET /api/analytics/overview?clientId=...&from=...&to=...&parts=core|breakdowns|all`
   - `GET /api/analytics/workflows?...`
   - `GET /api/analytics/campaigns?...`
   - `GET /api/analytics/response-timing?...`
   - `GET /api/analytics/crm/rows?clientId=...&cursor=...&limit=...` (pagination required)

2. Server-side caching (Redis read-through)
   - All caches must be user-scoped and include a version:
     - `analytics:v1:ver:{clientId}` (incr on recompute jobs)
     - key prefix: `analytics:v1:{userId}:{clientId}:{window}:{endpoint}:{filtersHash}:{ver}`
   - TTL targets:
     - overview core: 120s
     - overview breakdowns: 120s
     - workflows/campaigns/response timing: 120s
     - CRM rows: 30–60s per page (cursor-based keying)

3. Client chunking (Overview first)
   - Change `AnalyticsView` so overview fetches:
     1) `parts=core` (KPI cards + minimal summary)
     2) `parts=breakdowns` (charts + tables)
   - Render core immediately with skeleton placeholders for breakdowns.
   - Avoid “fan-out storms”: do not fetch every tab on initial mount; only fetch active tab.

4. Bounded sessionStorage persistence (perceived speed)
   - Persist last successful payload per:
     - `{userId}:{clientId}:{windowKey}:{tab}:{parts}`
   - TTL: 10 minutes
   - Cap: max 20 entries (evict oldest)
   - Always background-refresh and overwrite.

5. Optional derived aggregates (only if still slow after caching + chunking)
   - Introduce derived table(s) maintained by a recompute job:
     - `analytics_message_daily (client_id, day, channel, direction, message_count)`
   - Recompute last N days (e.g., 90) per active workspace.
   - Use aggregates for weekly stats and channel counts to reduce base-table scans.

6. Verification
   - Confirm no data leakage across workspaces/users.
   - Measure p95 server time for overview core and full overview with warm cache.

## Output
- Analytics reads are GET + Redis cached for the critical tabs.
- Overview renders core KPIs first and progressively loads heavy charts.
- Session persistence reduces perceived load on tab/window changes.

## Handoff
Proceed to Phase 155e to move recompute work to Inngest and standardize job status + retry behavior.

