# Phase 155 — Enterprise Inbox + Analytics Scale Completion + React #301 Closure

## Purpose
Finalize the Phase 154 architecture so Inbox and Analytics are production-grade under enterprise load, remove workspace-switch render-loop risk, and ship with measurable rollout/rollback controls.

## Locked Decisions
- Durable jobs: **Inngest**.
- Inngest env isolation: **Production uses `production`; Preview uses branch envs** (never `production`).
- Feature flags: **server-runtime evaluated** (no build-time-only rollback path).
- Observability: **enterprise baseline in-phase** (request IDs + structured logs + route metrics); external error platform wiring is deferred.
- Inbox freshness: **near-real-time (<15s)** using dirty marking + enqueue + invalidation.
- Realtime scope: **Lead INSERT + UPDATE only** (no Message subscription).
- Realtime fallback: **60s heartbeat** remains active.
- Analytics performance SLO: **p95 <1.5s warm cache, <3s cold**.
- Rollout: **canary 5% → 25% → 100%** with explicit stop gates.
- Counts model strategy: **sentinel `scopeUserId` for global rows** (no nullable unique ambiguity).
- Cache store: **Upstash Redis** (`lib/redis.ts`).
- Legacy reads: keep one **release-cycle fallback** behind runtime kill switch.
- Read API runtime policy: **production-safe default ON** (explicit env disable required), with one-cycle legacy fallback.
- Inbox list baseline: **server pagination** (no virtualization baseline).
- Cron cutover: **move `/api/cron/background-jobs` maintenance parity into Inngest** before enabling `BACKGROUND_JOBS_USE_INNGEST` broadly.
- Workspace UX parity from Phase 153: **hard release blocker** if regressed.

## Current-State Reality (Repo-Grounded)
- `getInboxCounts` computes eight categories and derives `awaitingReply` from `totalNonBlacklisted - requiresAttention` in `actions/lead-actions.ts`.
- Dashboard realtime now uses session-auth subscriptions via `lib/realtime-session.ts` (Lead `INSERT/UPDATE` only, workspace-filtered); legacy anon helper remains in `lib/supabase.ts` but is no longer used by inbox/CRM views.
- Read APIs are now runtime-gated server-side via `lib/feature-flags.ts` + `READ_API_DISABLED` fail-open behavior in inbox/analytics clients.
- Read API runtime flags now resolve with server-env precedence and production-safe defaults (`INBOX_READ_API_V1` / `ANALYTICS_READ_API_V1` first, `NEXT_PUBLIC_*` fallback), plus disabled-path diagnostics (`x-zrg-read-api-reason`, `x-request-id`, structured disabled logs) across inbox/analytics read routes.
- Analytics GET routes now exist for overview/workflows/campaigns/response timing/CRM rows; non-overview Redis versioning, client sessionStorage/LRU caching, and overview split-query execution are now implemented, with p95 evidence packet still pending for full 155d SLO closure.
- Analytics Redis caching now exists both in `actions/analytics-actions.ts:getAnalytics` and non-overview GET routes with scoped keys + route TTLs; version invalidation is wired via `analytics:v1:ver:{clientId}` bump on dirty-mark writes, and analytics tabs now hydrate from bounded sessionStorage cache before background refresh.
- Analytics read routes now emit `x-zrg-duration-ms` (plus `x-zrg-cache`) on successful responses to support canary warm/cold latency packet capture.
- Current production incident: Jam captures (`ab6733e6-9088-45b8-bedd-c8657b534d76`, `a87e4cbb-8c33-4cf6-a3de-08cce131b652`) show analytics and inbox read endpoints returning `503` with `READ_API_DISABLED` and `x-zrg-read-api-enabled: 0`, blocking canary SLO evidence collection until gate recovery.
- `InboxCounts` and `InboxCountsDirty` Prisma models now exist and are synced to DB; dirty-mark + recompute helpers are present but durable enqueue wiring is still pending.
- Inngest is now wired and verified in production (`/api/inngest` sync succeeds; event `background/process.requested` triggers `process-background-jobs`).
- `BACKGROUND_JOBS_USE_INNGEST=true` now enqueues both process + maintenance events and falls back inline if enqueue fails; safe canary rollout remains required before 100%.
- Workspace-switch regression harness now exists in-repo (`playwright.config.mjs`, `e2e/workspace-switch.spec.mjs`) with stable selectors wired in sidebar/inbox/error-boundary components; runnable evidence is pending a network-enabled Playwright environment plus authenticated session state.

## Repo Reality Check (RED TEAM)

- What exists today:
  - Inngest foundation:
    - route handler: `app/api/inngest/route.ts`
    - client: `lib/inngest/client.ts`
    - function registry: `lib/inngest/functions/index.ts`
  - Cron enqueue gate (parity hardened in 155g): `app/api/cron/background-jobs/route.ts`
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

## Hard Release Blockers (Phase 155)
- Workspace-switch flow remains stable under rapid switching (no React #301, no persistent "Error loading conversations", no stuck transition state).
- Read APIs are healthy in production (`x-zrg-read-api-enabled: 1`) and no sustained `READ_API_DISABLED` 503s are present in Jam/console verification windows.
- Analytics SLO evidence packet exists with real workspace IDs and shows p95 targets (`<1.5s warm`, `<3s cold`) from `x-zrg-duration-ms` + `x-zrg-cache` samples.

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
- ~~Enabling `BACKGROUND_JOBS_USE_INNGEST=true` drops `/api/cron/background-jobs` maintenance work (stale draft recovery + pruning)~~ → **closed in 155g** via `background/maintenance.requested` + shared maintenance helper.
- `INNGEST_ENV=production` configured for Preview deployments can cause preview syncs to overwrite production sync URLs/definitions → restrict `INNGEST_ENV` to Production only (or unset and rely on `VERCEL_ENV` logic) and verify preview isolation.
- ~~Inngest enqueue failure from cron currently hard-fails the cron tick~~ → **closed in 155g** via inline fallback execution when enqueue fails.
- ~~Read APIs currently fail closed when runtime flag env vars are unset/misconfigured, producing global `READ_API_DISABLED` 503s across inbox/analytics GET paths in production~~ → **mitigated in code** via production-safe defaults and explicit disabled-route diagnostics; still requires production redeploy/env verification.

### Missing or ambiguous requirements
- Counts freshness target is stated (<15s) but current materialized read considers rows valid for `INBOX_COUNTS_STALE_MS=5m` → define the actual freshness contract and enforce it via durable recompute + version bump.
- Analytics SLO still requires final validation work beyond route coverage → capture p95 warm/cold evidence packet from canary and compare against gates.
- Runtime flag precedence/default behavior is not yet codified for production safety (`server env` vs `NEXT_PUBLIC_*` compatibility) → lock precedence and safe defaults in code and ops docs.

### Observability / rollout gaps
- “Enterprise observability baseline” still needs consistency work across non-read routes/workers → complete request-ID + structured logging standardization and treat as rollout stop gate.
- Canary plan exists but needs evidence packet format (what dashboards/log queries prove gates are green) → add a verification packet checklist.

### Multi-agent coordination
- Uncommitted local changes detected in `lib/auto-send/revision-agent.ts` (out of phase scope) → require a clean worktree before release verification and document conflict resolution if that file is touched by later phases.

## Phase Summary (running)
- 2026-02-16 07:53:06Z — Completed local Phase 155a runtime-flag conversion: server-only flag resolver, read API runtime gating, client API-first fallback behavior, and local quality gates (`lint`, `typecheck`, `build`) passing. Canary/deploy verification remains pending Vercel access. (files: `lib/feature-flags.ts`, `app/api/inbox/counts/route.ts`, `app/api/inbox/conversations/route.ts`, `app/api/inbox/conversations/[leadId]/route.ts`, `app/api/analytics/overview/route.ts`, `components/dashboard/inbox-view.tsx`, `components/dashboard/sidebar.tsx`, `components/dashboard/analytics-view.tsx`, `docs/planning/phase-155/a/plan.md`, `docs/planning/phase-155/plan.md`)
- 2026-02-16 08:10:08Z — Completed Phase 155b core materialized counts implementation with safe schema sync (no backup-table drop), corrected recompute total semantics, and validated with `db:push`, `lint`, `typecheck`, `build`, and `npm test` (384/384 passing). Also removed inbox virtualizer path in `components/dashboard/conversation-feed.tsx` to eliminate the remaining React #301 hotspot seen on workspace switching. Durable enqueue/orchestration and session-auth realtime remain pending (`155c` + `155e`). (files: `prisma/schema.prisma`, `actions/lead-actions.ts`, `lib/inbox-counts.ts`, `lib/inbox-counts-constants.ts`, `lib/inbox-counts-dirty.ts`, `lib/inbox-counts-recompute.ts`, `lib/inbox-counts-runner.ts`, `components/dashboard/conversation-feed.tsx`, `docs/planning/phase-155/b/plan.md`, `docs/planning/phase-155/plan.md`)
- 2026-02-16 10:22:00Z — Verified Inngest Production wiring end-to-end: `/api/inngest` reachable on `zrg-dashboard.vercel.app` with `x-inngest-env: production`, successful sync/registration, and event `background/process.requested` triggers `process-background-jobs` run completion. (files: `app/api/inngest/route.ts`, `lib/inngest/client.ts`, `lib/inngest/functions/process-background-jobs.ts`, `docs/planning/phase-155/e/plan.md`, `docs/planning/phase-155/plan.md`)
- 2026-02-16 11:23:00Z — Completed Phase 155g cutover hardening: cron now enqueues both process + maintenance events, enqueue failures run inline fallback, maintenance parity moved into shared helper + dedicated Inngest function, and Redis job-status keys now record process/maintenance execution state. Validation passed: `lint`, `build`, `typecheck`, `npm test` (384/384), `test:ai-drafts`, and replay fallback commands with artifact `.artifacts/ai-replay/run-2026-02-16T10-59-17-959Z.json`. (files: `app/api/cron/background-jobs/route.ts`, `lib/background-jobs/maintenance.ts`, `lib/inngest/events.ts`, `lib/inngest/functions/process-background-jobs.ts`, `lib/inngest/functions/background-maintenance.ts`, `lib/inngest/functions/index.ts`, `lib/inngest/job-status.ts`, `lib/__tests__/draft-pipeline-retention-cron.test.ts`, `lib/__tests__/stale-sending-recovery.test.ts`, `docs/planning/phase-155/g/plan.md`, `docs/planning/phase-155/plan.md`)
- 2026-02-16 12:31:00Z — Completed Phase 155c realtime hardening implementation: migrated inbox/CRM subscriptions to session-auth helper (`lib/realtime-session.ts`), restricted browser realtime scope to `Lead INSERT/UPDATE` with workspace filter, added debounced invalidation in inbox callback to prevent render churn, and authored RLS rollout SQL artifact (`docs/planning/phase-155/c/realtime-rls-rollout.sql`). Validation passed: `lint` (warnings only), `typecheck`, `build`. (files: `lib/realtime-session.ts`, `components/dashboard/inbox-view.tsx`, `components/dashboard/crm-view.tsx`, `docs/planning/phase-155/c/realtime-rls-rollout.sql`, `docs/planning/phase-155/c/plan.md`, `docs/planning/phase-155/plan.md`)
- 2026-02-16 13:24:00Z — Advanced Phase 155d read-path migration: added GET routes for workflows/campaigns/response timing/CRM rows (including summary + assignees mode), centralized analytics read-route helpers, switched analytics + CRM table reads to API-first with runtime fail-open fallback, and applied per-endpoint cache headers (`max-age` + `stale-while-revalidate`) for faster repeat reads. Validation passed: `typecheck`, `lint` (warnings only), `build`. Remaining for full 155d closure: non-overview Redis versioned caching, sessionStorage/LRU cache contract, and formal p95 evidence packet. (files: `app/api/analytics/_helpers.ts`, `app/api/analytics/overview/route.ts`, `app/api/analytics/workflows/route.ts`, `app/api/analytics/campaigns/route.ts`, `app/api/analytics/response-timing/route.ts`, `app/api/analytics/crm/rows/route.ts`, `components/dashboard/analytics-view.tsx`, `components/dashboard/analytics-crm-table.tsx`, `docs/planning/phase-155/d/plan.md`, `docs/planning/phase-155/plan.md`)
- 2026-02-16 14:06:00Z — Continued Phase 155d cache hardening: added Redis read-through route caching keyed by `userId + clientId + endpoint + params + analytics version`, added `x-zrg-cache` hit/miss headers, and wired analytics version bump invalidation from `markInboxCountsDirty`. Validation passed: `typecheck`, `lint` (warnings only), `build`. Remaining for full 155d closure: client sessionStorage/LRU cache contract, overview split-query (`parts`), and p95 evidence capture. (files: `app/api/analytics/_helpers.ts`, `app/api/analytics/workflows/route.ts`, `app/api/analytics/campaigns/route.ts`, `app/api/analytics/response-timing/route.ts`, `app/api/analytics/crm/rows/route.ts`, `lib/inbox-counts-dirty.ts`, `docs/planning/phase-155/d/plan.md`, `docs/planning/phase-155/plan.md`)
- 2026-02-16 11:46:42Z — Completed Phase 155d client session-cache hardening: wired tab-scoped sessionStorage cache (`zrg:analytics:{userId}:{clientId}:{tab}:{parts}`) with TTL 10m + LRU cap 20, added stale-fast hydration and background refresh for overview/workflows/campaigns/response-timing tabs, and preserved action fallback semantics. Validation passed: `typecheck`, `lint` (warnings only), `build`. Remaining for full 155d closure: overview split-query (`parts`) and p95 warm/cold evidence packet. (files: `components/dashboard/analytics-view.tsx`, `docs/planning/phase-155/d/plan.md`, `docs/planning/phase-155/plan.md`)
- 2026-02-16 11:53:13Z — Completed Phase 155d overview split-query implementation: `getAnalytics` now supports part-scoped execution (`all|core|breakdowns`) with part-aware cache keys, overview GET route now caches by `parts` + analytics version and returns cache hit/miss headers, and analytics client overview flow now fetches `core` first then merges `breakdowns` in background. Validation passed: `typecheck`, `lint` (warnings only), `build`. Remaining for full 155d closure: canary p95 warm/cold evidence packet capture. (files: `actions/analytics-actions.ts`, `app/api/analytics/overview/route.ts`, `components/dashboard/analytics-view.tsx`, `docs/planning/phase-155/d/plan.md`, `docs/planning/phase-155/plan.md`)
- 2026-02-16 11:57:03Z — Added analytics latency instrumentation for canary evidence capture: all analytics GET read routes now stamp `x-zrg-duration-ms` on successful responses while preserving `x-zrg-cache` semantics for warm/cold differentiation. Validation passed: `typecheck`, `lint` (warnings only), `build`. Remaining for full 155d closure: production p95 warm/cold evidence packet capture. (files: `app/api/analytics/_helpers.ts`, `app/api/analytics/overview/route.ts`, `app/api/analytics/workflows/route.ts`, `app/api/analytics/campaigns/route.ts`, `app/api/analytics/response-timing/route.ts`, `app/api/analytics/crm/rows/route.ts`, `docs/planning/phase-155/d/plan.md`, `docs/planning/phase-155/plan.md`)
- 2026-02-16 12:52:00Z — Root-caused production analytics/inbox read-path outage via Jam evidence: repeated `503 READ_API_DISABLED` responses across `/api/analytics/*` and `/api/inbox/*` with `x-zrg-read-api-enabled: 0`. Locked remediation path: immediate env recovery + redeploy, then harden `lib/feature-flags.ts` to production-safe default ON with explicit-disable semantics and server-env precedence; keep legacy fallback for one release cycle. p95 packet capture is deferred until read APIs are re-enabled in production. (evidence: `https://jam.dev/c/ab6733e6-9088-45b8-bedd-c8657b534d76`, `https://jam.dev/c/a87e4cbb-8c33-4cf6-a3de-08cce131b652`)
- 2026-02-16 12:35:42Z — Implemented read-path outage hardening and observability signals: production-safe server-runtime flag resolution in `lib/feature-flags.ts`, request-id propagation + disabled-reason headers on inbox/analytics read routes, and structured disabled-route logs for rollout diagnostics. Validation passed: `typecheck`, `lint` (warnings only), `build`, `npm test` (384/384). Remaining for 155f closure: full request-ID/log standardization, workspace-switch E2E coverage, and production p95 evidence packet post-redeploy. (files: `lib/feature-flags.ts`, `app/api/analytics/_helpers.ts`, `app/api/analytics/overview/route.ts`, `app/api/analytics/workflows/route.ts`, `app/api/analytics/campaigns/route.ts`, `app/api/analytics/response-timing/route.ts`, `app/api/analytics/crm/rows/route.ts`, `app/api/inbox/counts/route.ts`, `app/api/inbox/conversations/route.ts`, `app/api/inbox/conversations/[leadId]/route.ts`, `docs/planning/phase-155/f/plan.md`, `docs/planning/phase-155/plan.md`)
- 2026-02-16 13:13:41Z — Updated 155/f release gate to 3 hard blockers (no Sentry dependency in-phase), added workspace-switch regression harness scaffolding, and wired deterministic test selectors for workspace switch + inbox/error-boundary assertions. Validation passed: `typecheck`, `lint` (warnings only), `build`, `npm test` (384/384). Playwright execution is blocked in this sandbox by network (`ENOTFOUND registry.npmjs.org` when resolving `playwright` via `npx`). (files: `docs/planning/phase-155/plan.md`, `docs/planning/phase-155/f/plan.md`, `components/dashboard/sidebar.tsx`, `components/dashboard/inbox-view.tsx`, `components/dashboard/dashboard-error-boundary.tsx`, `playwright.config.mjs`, `e2e/workspace-switch.spec.mjs`, `package.json`)

- 2026-02-17 — Terminus Maximus retroactive validation completed for Phase 155: global gates passed (lint/typecheck/build/test), review artifact present (docs/planning/phase-155/review.md), and subphase Output/Handoff integrity verified.
