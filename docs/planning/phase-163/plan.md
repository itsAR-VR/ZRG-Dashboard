# Phase 163 — Production Perf Variance Investigation + Playwright Perf Harness

## Purpose
Investigate and eliminate the “sometimes fast, sometimes extremely slow” loading behavior (primarily Master Inbox + Analytics), and ship an enterprise-grade debugging + Playwright-based performance regression harness so we can prevent reintroducing latency spikes.

## Context
- User report: load times vary wildly between runs; we need a root-cause fix (not band-aids) and a durable system to detect regressions.
- The codebase already has:
  - GET read APIs for inbox + analytics (`app/api/inbox/*`, `app/api/analytics/*`) with runtime feature flags (`INBOX_READ_API_V1`, `ANALYTICS_READ_API_V1`).
  - Redis/KV caching patterns and timing headers in analytics (`x-zrg-duration-ms`, `x-zrg-cache`) and request id plumbing in multiple routes.
  - An existing Playwright harness scaffold (Phase 155) but it is not yet a production-grade perf canary suite.
- Likely causes of variance (to validate with evidence):
  - Vercel cold starts / region variance / connection pool churn.
  - Supabase/Postgres saturation or missing indexes causing intermittent slow queries.
  - Cache-miss storms (version bumps/TTL alignment) or cache bypass via unstable keys.
  - Client refetch churn due to React effect anti-patterns, unstable query keys, or realtime reconnect loops.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 161 | Active | Inbox read API reliability (`/api/inbox/conversations`) | Keep changes additive and preserve existing flag semantics; extend observability without altering auth behavior. |
| Phase 155 | Active/partially closed | Read-path flags, caching, Playwright harness | Do not regress rollout/rollback contracts; reuse existing helpers and selectors. |
| Phase 154 / 153 | Completed | Inbox fetch strategy + workspace switching | Preserve workspace-switch UX guarantees and stable query-key patterns. |
| Phase 160 | Active | Uploads/asset flow artifacts | Out of scope; avoid touching knowledge-asset upload pipeline unless perf evidence proves a shared bottleneck. |
| Uncommitted working tree | Active | `docs/planning/phase-160/plan.md` modified + `artifacts/` untracked | Keep Phase 163 commits scoped; do not include unrelated artifacts in perf/test commits. |

## Objectives
* [ ] Produce a deterministic “variance evidence packet” (fast vs slow) with request IDs, endpoint durations, cache hit/miss, and correlation to server logs.
* [ ] Add production-grade observability to the inbox read path equivalent to analytics: request id + `x-zrg-duration-ms` + cache headers + structured logs for slow paths.
* [ ] Identify and fix the root cause(s) of latency variance:
  - query/index issues,
  - caching/versioning issues,
  - connection pooling/timeouts,
  - client refetch/render churn (React effect anti-patterns).
* [ ] Create a Playwright-based live perf regression suite that can be run:
  - locally against prod/preview URLs,
  - in CI (optional) with secrets-managed auth state.
* [ ] Ship with a rollback/runbook (feature flags + safe defaults) and no PII leakage in logs/artifacts.

## Constraints
- No secrets, cookies, tokens, or real user data committed to git.
- Multi-tenant safety: any caching must be keyed by `userId` + `clientId` + params; no cross-user leakage.
- Observability must scrub PII; prefer request-level metadata (durations/status/cache) over payloads.
- React performance work must follow “You might not need an effect” guidance: avoid effects for derived state and avoid refetch loops caused by unstable dependencies.
- Prefer additive, reversible changes with runtime flags and clear stop-gates.
- Quality gates must pass:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
  - `npm test`
- If any messaging/AI pipeline code is touched, run NTTAN gates:
  - `npm run test:ai-drafts`
  - `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
  - `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`

## Success Criteria
- We can reliably reproduce and categorize “fast vs slow” runs with an evidence packet:
  - per-endpoint `x-request-id`
  - per-endpoint `x-zrg-duration-ms`
  - per-endpoint cache signal (`x-zrg-cache` or equivalent)
  - server logs searchable by request id for the slow cases
- Inbox endpoints emit the same minimal perf/debug headers as analytics.
- Root causes are fixed (not just masked), and repeated runs show stable p95 server durations for:
  - `/api/inbox/counts`
  - `/api/inbox/conversations`
  - (and any other discovered hot endpoints)
- Playwright perf suite exists in-repo and can be run with one command to:
  - execute N repeated runs,
  - capture JSON output,
  - fail on explicit budgets with flake-resistant waiting.

## Subphase Index
* a — Baseline Repro + Evidence Packet (Playwright + Logs)
* b — Observability: Request IDs + Server Timing (Inbox)
* c — Backend Stabilization: Query/Cache/Pool Fixes (Supabase/Prisma)
* d — Frontend Stabilization: Refetch/Render Churn (React)
* e — Playwright Perf Suite + CI/Runbook + Rollout

