# Phase 155 — Enterprise Inbox + Analytics Scale Completion (Counts, Realtime RLS, Jobs, Chunking) + React #301 Closure

## Purpose
Complete the Phase 154 performance architecture so Inbox and Analytics remain fast and stable at enterprise scale, while eliminating the remaining React #301 workspace-switch crash vectors.

## Context
Phase 154 introduced the core shape of the new read path (GET read APIs + Redis caching) but does not yet include the enterprise-hardening layers that make performance predictable under load:
- **Counts** are still computed from live tables on cold cache; Redis helps but does not provide O(1) semantics.
- **Realtime** is currently wired with an anon-key client in `lib/supabase.ts` and must be moved to **session-auth + RLS** for tenant safety.
- **Background recompute** is still cron/request-driven; we need durable execution and status visibility (Inngest).
- **Analytics** is still heavy beyond the overview; we need GET endpoints for tabs, server-side caching, and client-side chunking/local persistence.
- Users still report **minified React error #301** (“Too many re-renders”) when switching workspaces in production; the fix requires targeted instrumentation and eliminating remaining render-loop triggers.

Locked decisions from the current discussion:
- Rollout strategy: **gradual + monitor**, feature-flag driven rollback.
- Inbox counts: **global + per-setter** stored materialized per workspace.
- Realtime: **session-auth + RLS**, subscribe to `Lead` **INSERT + UPDATE** only (no `Message` subscriptions).
- Freshness: **realtime + 60s heartbeat** (guards silent disconnects).
- UX: **require an active workspace** (no “All Workspaces” inbox/analytics scope).
- Durable jobs: **Inngest**.
- Analytics: prioritize **overview first**, allow **derived aggregate tables** if KV + chunking is insufficient.
- Local caching: **bounded sessionStorage** (keyed by user+workspace+window, TTL + max entries).
- Production debugging: **console-only** (no new Sentry work in this phase).
- Landing: Phase 154 changes should be **merged to main** and deployed behind flags.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 154 | In progress (partial shipped on `phase-154`) | Files: `actions/lead-actions.ts`, `actions/analytics-actions.ts`, `components/dashboard/*`, `app/api/inbox/*`, `app/api/analytics/*` | Phase 155 builds on Phase 154; merge Phase 154 before starting Phase 155 implementation work. |
| Phase 153 | Complete | Workspace switch UX, URL persistence (`components/dashboard/dashboard-shell.tsx`, `components/dashboard/inbox-view.tsx`) | Preserve “no stacked layout on switch”, no stuck spinner, and URL `clientId` persistence semantics. |
| Phase 152 | Tracked | React #301 workspace-switch hardening in inbox | Do not reintroduce unstable state resets or object-identity churn. |
| Phase 149 / 144 | Tracked | Dashboard render-loop hardening + performance | Keep query keys primitive/stable; avoid effect cascades and refetch churn. |
| Phase 145–146 | Active/tracked | AI replay + drafting behavior | Avoid touching AI prompt/draft logic unless explicitly required; if touched, NTTAN gates are mandatory. |

## Objectives
* [ ] Merge Phase 154 read-path changes to `main` and deploy behind feature flags with a rollback checklist.
* [ ] Materialize inbox counts in Postgres as O(1) reads (`inbox_counts`) with dirty marking + recompute job.
* [ ] Replace anon-key realtime subscriptions with session-authenticated Supabase Realtime + RLS and wire it to invalidate inbox queries.
* [ ] Speed up analytics beyond overview: add GET read APIs for tabs + Redis caching + client chunking + bounded session persistence.
* [ ] Move recompute/aggregation work into durable background jobs (Inngest) triggered by cron, with status visibility in Redis.
* [ ] Eliminate remaining React #301 workspace-switch crash vectors via instrumentation + targeted render-loop fixes.

## Constraints
- Multi-tenant safety first:
  - No shared CDN caching of authenticated payloads.
  - Redis cache keys must be scoped by `userId + clientId + filters + version`.
  - Realtime must be protected by RLS; no cross-tenant subscriptions.
- Preserve existing semantics:
  - Inbox filter categories and SETTER scoping must match `actions/lead-actions.ts:getInboxCounts`.
  - Inbox list filters must match cursor semantics in `actions/lead-actions.ts:getConversationsCursor`.
- Avoid render loops:
  - No state updates in render.
  - Effects must bail out with functional setters.
  - React Query keys must be primitive/stable (strings/numbers), not object identities.
- No secrets/PII in logs. Console instrumentation must be scrubbed and behind a debug gate if needed.
- Prefer additive, reversible work with feature flags and clear rollback steps.

## Success Criteria
- Phase 154 GET read APIs + Redis caching are merged to `main` and deployed behind flags:
  - `NEXT_PUBLIC_INBOX_READ_API_V1`
  - `NEXT_PUBLIC_ANALYTICS_READ_API_V1`
- Inbox counts are served as O(1) reads from `inbox_counts` (global + per-setter), with dirty marking + recompute runner.
- Realtime subscriptions use session auth + RLS and invalidate inbox list/counts without cross-tenant leakage.
- Analytics first-load improves measurably:
  - Overview core KPIs render quickly (chunked), with charts/breakdowns loading progressively.
  - Redis caching reduces repeated cold queries under concurrency.
- Durable jobs (Inngest) exist for counts recompute (and analytics aggregates if used) with retries/backoff and visible status keys.
- React #301 is no longer reproducible on workspace switching in a production build.
- Quality gates pass:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
  - `npm test`
- NTTAN validation is executed because this phase touches inbox/message surfaces:
  - `npm run test:ai-drafts`
  - `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
  - `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`

## Subphase Index
* a — Merge + Deploy Phase 154 Read Path Behind Flags (Gradual Rollout + Monitor)
* b — Inbox Counts Materialization (Postgres `inbox_counts` + Dirty Marking + Recompute)
* c — Supabase Realtime Enterprise Hardening (Session Auth + RLS + Invalidation Wiring)
* d — Analytics Read Path Completion (GET APIs + Redis Cache + Chunking + Session Persistence)
* e — Durable Background Jobs (Inngest) for Recompute/Aggregates + Status Visibility
* f — React #301 Workspace Switch Closure (Instrumentation + Loop Elimination + Verification)

