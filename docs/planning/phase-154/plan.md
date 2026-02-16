# Phase 154 — Enterprise Read Path Performance (Inbox + Analytics)

## Purpose
Make Master Inbox and Analytics faster and more scalable by moving read-heavy paths off client-invoked Server Actions (POST) onto cacheable GET read APIs with production-grade caching, and by shifting “refresh” to realtime invalidation and durable background jobs.

## Context
### Inbox (Master Inbox)
Today the inbox read path is dominated by:
- Client-side reads via Server Actions (`actions/lead-actions.ts`), which means POST-style RPC calls that are not CDN-cacheable and tend to encourage polling.
- High-frequency refetch loops in the UI:
  - `components/dashboard/inbox-view.tsx` uses `useInfiniteQuery(... refetchInterval ...)` for the conversation list.
  - `components/dashboard/sidebar.tsx` uses `setInterval(... getInboxCounts ...)` for counts.
- Counts are computed on-demand via raw SQL (`getInboxCounts`) that scans `Lead` rows and joins message/draft state. Under large workspaces this becomes expensive and can create “thundering herd” behavior when many users open the inbox.
- Supabase Realtime is used on the client but is currently wired via an anon-key client (`lib/supabase.ts`), which is not enterprise-safe without strict RLS and creates unclear tenancy guarantees.
- Background work is handled in request/cron routes (`app/api/cron/*`) without a durable queue (retries/backoff/concurrency), which becomes fragile under load.

### Analytics
Analytics currently loads via multiple Server Actions (`actions/analytics-actions.ts`, `actions/response-timing-analytics-actions.ts`, `actions/ai-draft-response-analytics-actions.ts`) that execute several expensive DB queries per tab/window. There is some local/in-memory caching, but it is not durable in serverless and does not prevent repeated cold-start DB load. Result: analytics often feels slow on first load and can spike DB utilization under concurrent use.

The user goal (Phase 146 “make it faster”) is to reduce repeated DB work, eliminate unnecessary polling, and make read paths enterprise-grade: predictable latency, safe multi-tenant behavior, and reliable background processing with clear rollout/rollback controls.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 153 | Completed + pushed | Inbox view workspace-switch reliability (`components/dashboard/inbox-view.tsx`), URL persistence (`components/dashboard/dashboard-shell.tsx`) | Phase 154 must preserve Phase 153 UX guarantees (no stacked layout on switch, no stuck spinner, URL `clientId` persistence). |
| Phase 152 | Recent/tracked | Workspace-switch render-loop hardening in `components/dashboard/inbox-view.tsx` | Preserve Phase 152’s “functional setter bail-outs” and object-identity stabilization; avoid introducing new render-loop vectors while changing fetch strategy. |
| Phase 149 | Recent/tracked | Dashboard render-loop hardening (React #301 closures) touching inbox surfaces | Keep query keys primitive/stable; avoid effect cascades and refetch churn. |
| Phase 146 / 143 | Tracked | Inbound/background job pipeline modules (`lib/background-jobs/*`, `lib/inbound-post-process/pipeline.ts`) | When adding a queue/worker pattern, do not break existing pipeline contracts; treat inbox read perf improvements as independent from AI routing logic. |

## Objectives
* [ ] Replace inbox read Server Actions with explicit GET APIs (list + counts + conversation detail), keeping Server Actions for writes only.
* [ ] Add a shared cache layer (Vercel KV) for short-TTL inbox list + counts reads with safe cache keys (user + workspace scoped).
* [ ] Make counts O(1) reads by maintaining `inbox_counts` per workspace (dirty marking + background recompute).
* [ ] Use Supabase Realtime deliberately: sessioned client + RLS, publish “counts changed / lead changed” signals so the UI stops polling.
* [ ] Move inbox-related background work off request/cron hot paths by enqueueing durable jobs (Inngest), with status stored in KV.
* [ ] Speed up analytics by applying the same architecture: GET read APIs + KV caching + chunked loading for heavy tabs, with optional pre-aggregates for the most expensive charts.
* [ ] Add safe “local caching” where it actually helps UX (tab/window memoization and session-scoped persistence) without risking cross-user/workspace leakage.
* [ ] Add baseline observability for the new read path (structured logs + request ids; error capture plan), and validate with required gates.

## Constraints
- No “shared CDN cache” for authenticated multi-tenant payloads unless response varies safely per user (default: do caching in KV keyed by `userId` + `clientId` + filters).
- Preserve existing filter semantics and role scoping (OWNER/ADMIN/INBOX_MANAGER vs SETTER assignment scoping) from `actions/lead-actions.ts`.
- Avoid reintroducing React render loops: keep query keys primitive, memoize functions passed into hooks, and avoid state updates in render.
- Any local caching must be:
  - keyed by `userId` + `clientId` + window/filter params
  - bounded by TTL and/or max entries
  - cleared on sign-out (best-effort) and never used for cross-user auth contexts
- Do not log secrets/PII. Any observability must be scrubbed.
- Prefer additive, reversible changes with feature flags and an emergency rollback path.

## Success Criteria
- Inbox list + counts + conversation detail are fetched via GET endpoints (not client Server Action POSTs).
- `components/dashboard/inbox-view.tsx` and `components/dashboard/sidebar.tsx` no longer run unconditional 60s polling loops when realtime is healthy; polling remains only as a slow fallback when realtime is disconnected.
- KV cache reduces repeated DB queries for identical inbox reads (verify via logs: `cacheHit` rate > 50% on steady-state).
- Counts reads are O(1) from `inbox_counts` (or KV) and do not scan all leads on every refresh.
- Realtime subscriptions are session-authenticated and protected by RLS; cross-workspace subscriptions do not leak.
- Cron endpoints enqueue durable jobs (Inngest) for inbox-related recompute/sync tasks; jobs have retries/backoff and status visibility.
- Analytics load time improves measurably:
  - First-load p95 for the Analytics overview tab is reduced via KV caching (target: < 2s server time after warm cache; < 5s cold is acceptable initially but should be measurable and trending down).
  - Analytics read calls are GET APIs (not client-invoked Server Actions), with caching and chunked loading for heavy sections.
- Quality gates pass:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
  - `npm test`
- Required AI/message validation gates (NTTAN) are explicitly run because inbox work touches messaging and follow-up flows:
  - `npm run test:ai-drafts`
  - `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
  - `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`

## Subphase Index
* a — GET Read APIs + Shared Query Extraction (Conversations + Detail + Counts)
* b — Vercel KV Cache Layer + Safe Cache Keys + Invalidation Primitives
* c — Workspace Inbox Counts Materialization (`inbox_counts`) + Dirty Marking + Recompute Job
* d — Supabase Realtime (Sessioned + RLS) + Client Invalidation + Remove High-Frequency Polling
* e — Durable Background Jobs (Inngest) + Cron-as-Trigger + Job Status in KV
* f — Observability + Load/Latency Validation + Rollout Checklist
* g — Analytics Read Path Speed (GET APIs + KV Cache + Chunking + Optional Pre-Aggregates)
