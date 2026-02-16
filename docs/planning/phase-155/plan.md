# Phase 155 — Enterprise Inbox + Analytics Scale Completion + React #301 Closure

## Purpose
Finalize the Phase 154 architecture so Inbox and Analytics are production-grade under enterprise load, remove workspace-switch render-loop risk, and ship with measurable rollout/rollback controls.

## Locked Decisions
- Durable jobs: **Inngest**.
- Inngest env isolation: **Production uses `production`; Preview uses branch envs** (never `production`).
- Feature flags: **server-runtime evaluated** (no build-time-only rollback path).
- Observability: **enterprise baseline** (`Sentry` + request IDs + structured logs + metrics).
- Inbox freshness: **near-real-time (<15s)** using dirty marking + enqueue + invalidation.
- Realtime scope: **Lead INSERT + UPDATE only** (no Message subscription).
- Realtime fallback: **60s heartbeat** remains active.
- Analytics performance SLO: **p95 <1.5s warm cache, <3s cold**.
- Rollout: **canary 5% → 25% → 100%** with explicit stop gates.
- Counts model strategy: **sentinel `scopeUserId` for global rows** (no nullable unique ambiguity).
- Cache store: **Upstash Redis** (`lib/redis.ts`).
- Legacy reads: keep one **release-cycle fallback** behind runtime kill switch.
- Inbox list baseline: **server pagination** (no virtualization baseline).
- Cron cutover: **move `/api/cron/background-jobs` maintenance parity into Inngest** before enabling `BACKGROUND_JOBS_USE_INNGEST` broadly.
- Workspace UX parity from Phase 153: **hard release blocker** if regressed.

## Current-State Reality (Repo-Grounded)
- `getInboxCounts` computes eight categories and derives `awaitingReply` from `totalNonBlacklisted - requiresAttention` in `actions/lead-actions.ts`.
- Realtime is currently wired via `lib/supabase.ts` with anon client and `event: "*"`, which is not acceptable for tenant-safe final state.
- Read APIs are now runtime-gated server-side via `lib/feature-flags.ts` + `READ_API_DISABLED` fail-open behavior in inbox/analytics clients.
- `app/api/analytics/overview/route.ts` exists, but other analytics GET tabs are still action-driven.
- Analytics Redis cache is currently user-scoped + TTL-based inside `actions/analytics-actions.ts:getAnalytics` (no version bump yet).
- `InboxCounts` and `InboxCountsDirty` Prisma models now exist and are synced to DB; dirty-mark + recompute helpers are present but durable enqueue wiring is still pending.
- Inngest is now wired and verified in production (`/api/inngest` sync succeeds; event `background/process.requested` triggers `process-background-jobs`).
- ⚠️ `BACKGROUND_JOBS_USE_INNGEST=true` currently short-circuits `/api/cron/background-jobs` and skips inline maintenance work (stale draft recovery + pruning). Do not enable for 100% until parity is implemented.

## Repo Reality Check (RED TEAM)

- What exists today:
  - Inngest foundation:
    - route handler: `app/api/inngest/route.ts`
    - client: `lib/inngest/client.ts`
    - function registry: `lib/inngest/functions/index.ts`
  - Cron enqueue gate (currently partial parity): `app/api/cron/background-jobs/route.ts`
  - Materialized counts + dirty helpers exist, but freshness target (<15s) is not yet enforced end-to-end.
- What the plan assumes:
  - Cron routes can enqueue durable work without dropping any maintenance responsibilities.
  - Inngest environments are isolated (preview does not mutate production).
- Verified touch points:
  - `app/api/inngest/route.ts` exports `GET/POST/PUT` and responds with `function_count`.
  - `https://zrg-dashboard.vercel.app/api/inngest` reports `x-inngest-env: production`.
  - Manual event send `background/process.requested` triggers `process-background-jobs` in Production.

## Objectives
- Merge and stabilize Phase 154 read-path work with server-runtime flags and canary rollout.
- Materialize inbox counts (`global + per-setter`) for O(1) reads.
- Replace anon realtime with session-authenticated realtime + RLS enforcement.
- Complete analytics GET read APIs with cache/chunking/session persistence to hit SLO.
- Move recompute/aggregation into durable Inngest jobs with retries/backoff and status visibility.
- Eliminate remaining React #301 causes and add regression protection.
- Ship enterprise observability baseline tied to rollout gates.

## Required Interfaces / Additions
- **Prisma models**:
  - `InboxCounts`
  - `InboxCountsDirty`
- **Sentinel constant**:
  - `GLOBAL_SCOPE_USER_ID = "00000000-0000-0000-0000-000000000000"`
- **Server-runtime flag source**:
  - centralized `lib/feature-flags.ts` (server evaluated)
- **Realtime helper**:
  - session-auth helper replacing dashboard use of `lib/supabase.ts`
- **Inngest wiring**:
  - event route + functions for recompute workloads
- **Analytics API routes**:
  - `/api/analytics/workflows`
  - `/api/analytics/campaigns`
  - `/api/analytics/response-timing`
  - `/api/analytics/crm/rows`

## Data / Cache Contracts
- Inbox counts cache version key: `inbox:v1:ver:{clientId}`
- Analytics cache version key: `analytics:v1:ver:{clientId}`
- User/workspace scoped cache key pattern:
  - `inbox:v1:{userId}:{clientId}:{filters}:{ver}`
  - `analytics:v1:{userId}:{clientId}:{from}:{to}:{endpoint}:{parts}:{ver}`
- Session storage key pattern:
  - `zrg:analytics:{userId}:{clientId}:{tab}:{parts}`
  - TTL: 10 minutes
  - Max entries: 20 (LRU eviction)

## Rollout and Stop Gates
- Canary stages: 5% then 25% then 100%.
- Minimum observation window per stage: 30 minutes.
- Automatic stop/rollback if any threshold is breached:
  - React #301 or dashboard error-boundary rate increases above baseline.
  - Auth failures (401/403) spike materially.
  - Analytics p95 exceeds SLO for two consecutive windows.
  - DB saturation or queue backlog exceeds defined alert threshold.
- Rollback must be available without redeploy through server-runtime flags.

## Quality Gates
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm test`
- `npm run test:ai-drafts` (smoke guard due to shared inbox surfaces)
- `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
- `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`

## Subphase Index
- `a` — Merge + Deploy Phase 154 Read Path with Server-Runtime Flags + Canary
- `b` — Inbox Counts Materialization (Prisma + Sentinel Scope + <15s Freshness)
- `c` — Supabase Realtime Hardening (Session Auth + RLS + Invalidation)
- `d` — Analytics Read Path Completion (GET APIs + Cache + Chunking + SLO)
- `e` — Durable Jobs with Inngest (Cron as trigger, retries/backoff, status)
- `f` — React #301 Closure + Enterprise Observability + Release Verification
- `g` — Inngest Cutover Hardening (Cron Parity + Env Hygiene + Safe Rollout)

## Phase Exit Criteria
- Workspace switching no longer reproduces React #301 in production build.
- Counts/read paths are O(1)+cached and meet freshness targets.
- Analytics endpoint latency meets SLO at warm and cold cache targets.
- Cross-tenant realtime leakage is proven absent by test.
- Inngest jobs are stable under retry and backlog scenarios.
- Observability baseline is live and rollback controls are verified.

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Enabling `BACKGROUND_JOBS_USE_INNGEST=true` drops `/api/cron/background-jobs` maintenance work (stale draft recovery + pruning) → implement parity in Inngest function(s) before full cutover (Phase 155g).
- `INNGEST_ENV=production` configured for Preview deployments can cause preview syncs to overwrite production sync URLs/definitions → restrict `INNGEST_ENV` to Production only (or unset and rely on `VERCEL_ENV` logic) and verify preview isolation.
- Inngest enqueue failure from cron currently hard-fails the cron tick → add fallback behavior (enqueue best-effort; if it fails, run inline or log + rely on next tick).

### Missing or ambiguous requirements
- Counts freshness target is stated (<15s) but current materialized read considers rows valid for `INBOX_COUNTS_STALE_MS=5m` → define the actual freshness contract and enforce it via durable recompute + version bump.
- Analytics SLO requires multi-endpoint GET API completion; only overview is routed → add explicit remaining endpoint plan + measurement gates.

### Observability / rollout gaps
- “Enterprise observability baseline” is a locked decision but not yet wired → define minimum shippable slice (Sentry + request IDs + structured logs) and treat as rollout stop gate.
- Canary plan exists but needs evidence packet format (what dashboards/log queries prove gates are green) → add a verification packet checklist.

### Multi-agent coordination
- Uncommitted local changes detected in `lib/auto-send/revision-agent.ts` (out of phase scope) → require a clean worktree before release verification and document conflict resolution if that file is touched by later phases.

## Phase Summary (running)
- 2026-02-16 07:53:06Z — Completed local Phase 155a runtime-flag conversion: server-only flag resolver, read API runtime gating, client API-first fallback behavior, and local quality gates (`lint`, `typecheck`, `build`) passing. Canary/deploy verification remains pending Vercel access. (files: `lib/feature-flags.ts`, `app/api/inbox/counts/route.ts`, `app/api/inbox/conversations/route.ts`, `app/api/inbox/conversations/[leadId]/route.ts`, `app/api/analytics/overview/route.ts`, `components/dashboard/inbox-view.tsx`, `components/dashboard/sidebar.tsx`, `components/dashboard/analytics-view.tsx`, `docs/planning/phase-155/a/plan.md`, `docs/planning/phase-155/plan.md`)
- 2026-02-16 08:10:08Z — Completed Phase 155b core materialized counts implementation with safe schema sync (no backup-table drop), corrected recompute total semantics, and validated with `db:push`, `lint`, `typecheck`, `build`, and `npm test` (384/384 passing). Also removed inbox virtualizer path in `components/dashboard/conversation-feed.tsx` to eliminate the remaining React #301 hotspot seen on workspace switching. Durable enqueue/orchestration and session-auth realtime remain pending (`155c` + `155e`). (files: `prisma/schema.prisma`, `actions/lead-actions.ts`, `lib/inbox-counts.ts`, `lib/inbox-counts-constants.ts`, `lib/inbox-counts-dirty.ts`, `lib/inbox-counts-recompute.ts`, `lib/inbox-counts-runner.ts`, `components/dashboard/conversation-feed.tsx`, `docs/planning/phase-155/b/plan.md`, `docs/planning/phase-155/plan.md`)
- 2026-02-16 10:22:00Z — Verified Inngest Production wiring end-to-end: `/api/inngest` reachable on `zrg-dashboard.vercel.app` with `x-inngest-env: production`, successful sync/registration, and event `background/process.requested` triggers `process-background-jobs` run completion. (files: `app/api/inngest/route.ts`, `lib/inngest/client.ts`, `lib/inngest/functions/process-background-jobs.ts`, `docs/planning/phase-155/e/plan.md`, `docs/planning/phase-155/plan.md`)
