# Phase 154g — Analytics Read Path Speed (GET APIs + KV Cache + Chunking + Optional Pre-Aggregates)

## Focus
Reduce analytics time-to-first-insight and steady-state DB load by moving analytics reads off client Server Actions and onto GET read APIs with Redis caching, and by chunking heavy sections so the UI renders fast even when some charts are still loading.

## Inputs
- Analytics UI entrypoints:
  - `components/dashboard/analytics-view.tsx` (overview, workflows, campaigns, booking, CRM, response timing)
  - `components/dashboard/analytics-crm-table.tsx` (CRM tab: table + inline edits)
- Server Actions:
  - `actions/analytics-actions.ts` (`getAnalytics`, `getEmailCampaignAnalytics`, `getWorkflowAttributionAnalytics`, `getReactivationCampaignAnalytics`, CRM helpers)
  - `actions/response-timing-analytics-actions.ts`
  - `actions/ai-draft-response-analytics-actions.ts`
- Existing caching:
  - client-side `useRef` cache in `AnalyticsView` (TTL 90s)
  - server-side in-memory cache map in `actions/analytics-actions.ts` (TTL 5m, not durable in serverless)
- Redis primitives from Phase 154b.

## Work
### 1) Define the new read API surface (GET only)
Create route handlers (scoped by auth + `clientId` access):
- `GET /api/analytics/overview?clientId=...&from=...&to=...`
- `GET /api/analytics/workflows?...`
- `GET /api/analytics/campaigns?...`
- `GET /api/analytics/booking?...` (if needed; depends on current server action usage)
- `GET /api/analytics/response-timing?...`
- `GET /api/analytics/crm/rows?...` (read only; keep edits as Server Actions for now)

Constraints:
- Responses must be private/user-scoped (no shared CDN caching).
- All endpoints must apply existing authorization rules (match `accessibleClientWhere` / `resolveClientScope` patterns).

### 2) KV caching (server-side, production-grade)
Implement Redis caching around each endpoint with:
- Key: `analytics:v1:{userId}:{clientId}:{window}:{endpoint}:{otherFiltersHash}:{ver}`
- TTL defaults:
  - overview: 120s
  - workflows/campaigns/response timing: 120s
  - CRM rows: 30-60s (pagination required; cache only stable pages)

Cache invalidation strategy:
- Use a workspace version key `analytics:v1:ver:{clientId}` (KV incr).
- Bump version when high-level analytics inputs change (e.g., message ingestion, appointment booking state changes) via cron/job hooks.
- Keep invalidation conservative first: time-based TTL + optional version bump from periodic jobs; do not wire every write path on day 1.

### 3) Chunking and local caching (client UX)
In `components/dashboard/analytics-view.tsx`:
- Keep the existing per-tab memoization, but switch data fetching to GET APIs.
- Chunk the Overview tab into at least two independent loads:
  1) “Core KPIs” (fast counts + response rate + meetings booked)
  2) “Charts and breakdowns” (sentiment breakdown, weekly message stats, top clients, sms sub-clients, capacity utilization)
- Render Core KPIs immediately; show skeletons for the rest.
- Add optional session-scoped local persistence:
  - write last successful payload to `sessionStorage` keyed by `{userId}:{clientId}:{windowKey}:{tab}`
  - load immediately on mount and refresh in background
  - hard cap stored entries (e.g., 20 keys) and TTL (e.g., 10 minutes)

In `components/dashboard/analytics-crm-table.tsx`:
- Ensure the rows endpoint is paginated (cursor/limit) and only fetches the visible page.
- Keep edits as Server Actions (writes), but add a post-write cache invalidation call (`analytics:v1:ver:{clientId}` bump).

### 4) Optional pre-aggregates (only if still slow after KV + chunking)
If overview is still slow after caching, add a small number of OLAP-friendly aggregates:
- `analytics_message_daily` (per workspace/day/channel/direction counts)
- Refresh strategy:
  - cron/enqueued job recomputes last N days (e.g., 90) for active workspaces
  - avoids per-message triggers in hot paths

Schema (Postgres, production-grade):
```sql
create table if not exists analytics_message_daily (
  client_id uuid not null,
  day date not null,                 -- UTC day bucket
  channel text not null,             -- sms|email|linkedin (enforce via CHECK if desired)
  direction text not null,           -- inbound|outbound (enforce via CHECK if desired)
  message_count int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (client_id, day, channel, direction),
  constraint analytics_message_daily_nonneg_ck check (message_count >= 0)
);

create index if not exists analytics_message_daily_client_day_idx
  on analytics_message_daily (client_id, day desc);
```

Notes:
- Denormalized aggregate tables are acceptable here (OLAP-ish reads) because they are derived data.
- Writes happen only via background recompute, not inline triggers, to protect ingestion throughput.

### 5) Validation
- Verify analytics still respects workspace scoping and does not leak data across users.
- Verify no new polling loops are introduced (react-query keys stable; effects bounded).
- Run full repo gates + NTTAN (Phase 154 root success criteria).

## Output
- Analytics reads are GET APIs with KV caching.
- Analytics Overview renders quickly (core KPIs first) and progressively fills in charts.
- Heavy CRM table is paginated and does not block the rest of analytics.

## Handoff
After Phase 154g, update Phase 154f validation notes with before/after latency measurements and KV hit rates.
