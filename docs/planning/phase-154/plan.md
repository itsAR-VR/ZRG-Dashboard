# Phase 154 — Enterprise Inbox Read Path (GET APIs + KV Cache + Realtime + Durable Jobs)

## Purpose
Make Master Inbox (list + counts + conversation detail) faster and more scalable by replacing high-frequency client Server Action polling (POST) with cacheable GET read APIs, adding a shared cache, and shifting “refresh” to realtime invalidation and durable background jobs.

## Context
Today the inbox read path is dominated by:
- Client-side reads via Server Actions (`actions/lead-actions.ts`), which means POST-style RPC calls that are not CDN-cacheable and tend to encourage polling.
- High-frequency refetch loops in the UI:
  - `components/dashboard/inbox-view.tsx` uses `useInfiniteQuery(... refetchInterval ...)` for the conversation list.
  - `components/dashboard/sidebar.tsx` uses `setInterval(... getInboxCounts ...)` for counts.
- Counts are computed on-demand via raw SQL (`getInboxCounts`) that scans `Lead` rows and joins message/draft state. Under large workspaces this becomes expensive and can create “thundering herd” behavior when many users open the inbox.
- Supabase Realtime is used on the client but is currently wired via an anon-key client (`lib/supabase.ts`), which is not enterprise-safe without strict RLS and creates unclear tenancy guarantees.
- Background work is handled in request/cron routes (`app/api/cron/*`) without a durable queue (retries/backoff/concurrency), which becomes fragile under load.

The user goal (Phase 146 “make it faster”) is to reduce repeated DB work, reduce re-render/polling cascades, and make inbox reads enterprise-grade: predictable latency, safe multi-tenant behavior, and reliable background processing.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 153 | Active (untracked + WIP in git status) | `components/dashboard/inbox-view.tsx` layout wrapper + message-pane spinner; `components/dashboard/dashboard-shell.tsx` workspace URL persistence (planned) | Phase 154 changes MUST be rebased on top of Phase 153’s final InboxView structure (single flex-row wrapper) and any workspace URL (`clientId`) persistence. Do not start refactors until Phase 153 code changes are committed or intentionally set aside. |
| Phase 152 | Recent/tracked | Workspace-switch render-loop hardening in `components/dashboard/inbox-view.tsx` | Preserve Phase 152’s “functional setter bail-outs” and object-identity stabilization; avoid introducing new render-loop vectors while changing fetch strategy. |
| Phase 149 | Recent/tracked | Dashboard render-loop hardening (React #301 closures) touching inbox surfaces | Keep query keys primitive/stable; avoid effect cascades and refetch churn. |
| Phase 146 / 143 | Tracked | Inbound/background job pipeline modules (`lib/background-jobs/*`, `lib/inbound-post-process/pipeline.ts`) | When adding a queue/worker pattern, do not break existing pipeline contracts; treat inbox read perf improvements as independent from AI routing logic. |

## Objectives
* [ ] Replace inbox read Server Actions with explicit GET APIs (list + counts + conversation detail), keeping Server Actions for writes only.
* [ ] Add a shared cache layer (Vercel KV) for short-TTL inbox list + counts reads with safe cache keys (user + workspace scoped).
* [ ] Make counts O(1) reads by maintaining `inbox_counts` per workspace (dirty marking + background recompute).
* [ ] Use Supabase Realtime deliberately: sessioned client + RLS, publish “counts changed / lead changed” signals so the UI stops polling.
* [ ] Move inbox-related background work off request/cron hot paths by enqueueing durable jobs (Inngest), with status stored in KV.
* [ ] Add baseline observability for the new read path (structured logs + request ids; error capture plan), and validate with required gates.

## Constraints
- No “shared CDN cache” for authenticated multi-tenant inbox payloads unless response varies safely per user (default: do caching in KV keyed by `userId` + `clientId` + filters).
- Preserve existing filter semantics and role scoping (OWNER/ADMIN/INBOX_MANAGER vs SETTER assignment scoping) from `actions/lead-actions.ts`.
- Avoid reintroducing React render loops: keep query keys primitive, memoize functions passed into hooks, and avoid state updates in render.
- Do not log secrets/PII. Any observability must be scrubbed.
- Do not combine Phase 154 refactors with uncommitted Phase 153 changes: first reconcile git state.

## Success Criteria
- Inbox list + counts + conversation detail are fetched via GET endpoints (not client Server Action POSTs).
- `components/dashboard/inbox-view.tsx` and `components/dashboard/sidebar.tsx` no longer run unconditional 60s polling loops when realtime is healthy; polling remains only as a slow fallback when realtime is disconnected.
- KV cache reduces repeated DB queries for identical inbox reads (verify via logs: `cacheHit` rate > 50% on steady-state).
- Counts reads are O(1) from `inbox_counts` (or KV) and do not scan all leads on every refresh.
- Realtime subscriptions are session-authenticated and protected by RLS; cross-workspace subscriptions do not leak.
- Cron endpoints enqueue durable jobs (Inngest) for inbox-related recompute/sync tasks; jobs have retries/backoff and status visibility.
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

