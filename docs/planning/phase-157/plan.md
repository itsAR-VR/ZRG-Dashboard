# Phase 157 — Analytics Latency Closure + CRM Query Reliability

## Purpose
Close the remaining analytics performance gap now that Inbox/CRM navigation is fast, and remove production instability in analytics endpoints so analytics feels consistently fast at enterprise scale.

## Context
- User-reported state: "everything except analytics feels very fast".
- Latest CRM Jam (`https://jam.dev/c/6622f360-5e85-4fd6-b8e4-9e03e18ddbee`) captured a production `500` on `GET /api/analytics/crm/rows?mode=summary` with Postgres `42P18` (`could not determine data type of parameter $4`).
- Root cause was identified in `actions/analytics-actions.ts:getCrmWindowSummary` (nullable raw-query bind pattern) and patched locally, but rollout verification is still pending.
- Phase 155 delivered read APIs + Redis/session cache + timing headers; remaining work is latency closure, query efficiency, and hard rollout evidence.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 155 | Active/partially closed | `app/api/analytics/*`, `components/dashboard/analytics-view.tsx`, `components/dashboard/analytics-crm-table.tsx`, `actions/analytics-actions.ts` | Phase 157 extends 155d/f closure. Preserve existing cache/version/flag contracts and append evidence instead of redefining architecture. |
| Phase 156 | Active | `components/dashboard/settings-view.tsx` and dashboard UI surfaces | Keep analytics changes scoped to analytics components/routes only; avoid settings IA edits. |
| Uncommitted concurrent work | Active | `actions/analytics-actions.ts` modified; `docs/planning/phase-156/` and `test-results/` untracked | Do not revert concurrent edits. Merge semantically and isolate Phase 157 file touches. |

## Repo Reality Check (RED TEAM)

- What exists today:
  - Analytics read routes exist: `app/api/analytics/overview/route.ts`, `app/api/analytics/workflows/route.ts`, `app/api/analytics/campaigns/route.ts`, `app/api/analytics/response-timing/route.ts`, `app/api/analytics/crm/rows/route.ts`.
  - Route-level caching helpers + timing headers exist in `app/api/analytics/_helpers.ts` (`x-zrg-cache`, `x-zrg-duration-ms`).
  - Client tab-level lazy loading + session cache exists in `components/dashboard/analytics-view.tsx`.
  - CRM table now has debounced filters and row virtualization in `components/dashboard/analytics-crm-table.tsx`.
  - Core heavy aggregation logic remains in `actions/analytics-actions.ts` and `actions/response-timing-analytics-actions.ts`.
- What this phase assumes:
  - Read-path architecture is stable; bottleneck is now query cost + frontend rendering/fetch behavior.
  - Redis cache is healthy and can be measured via hit/miss headers.
- Verified touch points:
  - `actions/analytics-actions.ts:getAnalytics`, `getEmailCampaignAnalytics`, `getCrmWindowSummary`, `getCrmSheetRows`
  - `actions/response-timing-analytics-actions.ts:getResponseTimingAnalytics`
  - `components/dashboard/analytics-view.tsx`
  - `components/dashboard/analytics-crm-table.tsx`

## Objectives
* [x] Eliminate analytics `500` regressions (starting with CRM summary `42P18`) and codify safe raw SQL bind patterns.
* [ ] Achieve production analytics latency SLO with evidence packet (warm and cold) across overview/workflows/campaigns/response-timing/CRM summary endpoints.
* [x] Reduce backend query cost for top latency contributors (`getAnalytics`, `getEmailCampaignAnalytics`, `getCrmWindowSummary`).
* [x] Improve analytics perceived speed in UI (fast first paint + reduced refetch churn + scalable row rendering).
* [ ] Ship with safe rollout/rollback controls and clear stop gates.

## Constraints
- Preserve Phase 155 runtime flag behavior (`INBOX_READ_API_V1`, `ANALYTICS_READ_API_V1`) and auth scoping.
- Keep Server Actions for writes; read-path improvements remain GET-first.
- No destructive data operations.
- If Prisma schema/index changes are required, include migration-safe rollout plus `npm run db:push` and verification.
- Avoid cross-phase edits outside analytics scope.
- Do not regress React #301 closure work or inbox responsiveness.

## Non-Goals
- No settings IA changes (`components/dashboard/settings-view.tsx` remains out of scope).
- No inbox write-path refactor.
- No AI draft/prompt behavior changes in this phase.

## Success Criteria
- CRM summary endpoint no longer returns `42P18`/`500` in production; Jam repro path passes.
- Analytics endpoint p95 (from `x-zrg-duration-ms`) meets targets in canary windows:
  - Warm cache: `< 1.5s` for overview/workflows/campaigns/response-timing, `< 2.0s` for CRM summary.
  - Cold cache: `< 3.0s` for overview/workflows/campaigns/response-timing, `< 3.5s` for CRM summary.
  - Fixed sampling protocol: `8 cold + 8 warm` samples per endpoint with real workspace `clientId` values.
- Warm-cache `x-zrg-cache=hit` rate is consistently measurable and improving on repeat-tab usage.
- Analytics UI avoids avoidable churn:
  - CRM filter changes are debounced.
  - CRM rows use virtualization/windowing for large datasets.
- Validation gates pass:
  - `npm run lint` ✅
  - `npm run typecheck` ✅
  - `npm run build` ✅
  - `npm test` ✅

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- CRM table virtualization can break inline-edit UX if edited rows unmount during scroll.
  - Mitigation: preserve stable row identity + overscan and add explicit edit-state persistence checks.
- Index changes can regress production write throughput if applied without rollout controls.
  - Mitigation: treat index rollout as canary-gated with before/after query-plan evidence and rollback path.
- Precompute path can drift from live-query logic and return stale or inconsistent business metrics.
  - Mitigation: enforce parity checks against live-query snapshots before enabling precompute broadly.

### Missing or ambiguous requirements
- SLO measurement packet sample size is now fixed at `8 cold + 8 warm` per endpoint.
- Precompute strategy is now fixed to table-backed rollups first, with runtime fallback to live-query path.
- CRM virtualization scope is now fixed to full row virtualization with edit-state guardrails.

### Performance / timeouts
- Query timeout budgets are not yet explicit per heavy analytics function.
  - Plan fix: enforce explicit `statement_timeout` expectations and capture timeout telemetry in 157c.

### Security / permissions
- Explicit 401/403 regression validation for analytics read routes is not spelled out in rollout steps.
  - Plan fix: add auth negative-case checks in final rollout packet (157g).

### Testing / validation
- Existing validation lacks a dedicated failure-mode drill (Redis down, cache-miss storms, read-flag rollback).
  - Plan fix: add 157g for rollback + failure-mode rehearsal and auth checks.
- Production latency packet still requires authenticated canary execution with real workspace context.
  - Plan fix: provide a deterministic probe script and capture the packet from authenticated production session.

### Multi-agent coordination
- `actions/analytics-actions.ts` already has uncommitted concurrent edits (CRM fix), creating merge-risk for 157b/157c.
  - Plan fix: keep a conflict log and re-read current file state before each subphase edit touching this file.
- New concurrent edits appeared outside 157 scope during execution (`app/auth/login/page.tsx`, `components/dashboard/dashboard-shell.tsx`).
  - Plan fix: pause phase commits until user confirms whether to proceed with isolated 157 staging amid concurrent mutations.

## Assumptions (Agent)
- Analytics read API contract from Phase 155 remains stable and should be optimized in-place (confidence ~95%).
- No NTTAN suite is required for this phase because no AI draft/prompt/reply behavior is being changed (confidence ~92%).
- If direct query + UI tuning still misses SLO, targeted index changes are allowed in production via canary rollout with explicit rollback.

## Locked Decisions (Human-Confirmed)
- [x] Schema/index policy: allow targeted index/schema changes if required, canary-gated with rollback.
- [x] CRM throughput scope: full row virtualization now (with edit-state guardrails and overscan).
- [x] Precompute strategy for 157e: table-backed Postgres rollups first; keep kill-switch fallback to live queries.
- [x] SLO evidence protocol for 157f: fixed `8 cold + 8 warm` samples per endpoint.

## Open Questions (Need Human Input)
- [ ] Who will run the authenticated canary evidence packet (8 cold + 8 warm) and provide the artifact JSON from `scripts/analytics-canary-probe.ts`? (confidence ~80%)
  - Why it matters: 157f/157g cannot be fully closed without authenticated warm/cold p95 and 403/rollback validation evidence.
  - Current assumption in this plan: user/operator runs the script in production-authenticated context and shares artifact path.

## Subphase Index
* a — Production Baseline + Failure Repro Packet
* b — CRM Summary Stability Hardening (Raw SQL Bind Safety)
* c — Backend Query Optimization + Index Plan
* d — Analytics Frontend Throughput (Debounce + Virtualization + Fetch Discipline)
* e — Cache/Precompute Acceleration (Redis + Inngest Aggregates)
* f — Validation, Canary Rollout, and Stop-Gate Evidence
* g — Failure-Mode Drill + Auth/Rollback Verification

## Phase Summary (running)
- 2026-02-16 — Implemented CRM summary raw-SQL bind hardening in `getCrmWindowSummary` by removing nullable bind predicates (`$param IS NULL OR ...`) and replacing them with typed SQL fragments (`responseModePredicateSql`, `bookedInWindowAnySql`, `bookedInWindowKeptSql`). This closes the `42P18` failure mode seen in Jam repros.
- 2026-02-16 — Reworked `getEmailCampaignAnalytics` to SQL-side aggregation instead of loading lead rows into JS memory. Added transaction-scoped aggregate queries for campaign KPIs, sentiment breakdown, industry breakdown, and headcount breakdown while preserving the existing API response contract.
- 2026-02-16 — Completed analytics CRM frontend throughput updates in `components/dashboard/analytics-crm-table.tsx`: debounced text filters, normalized/stable filter-window memoization, bounded scroll viewport, and row virtualization with spacer rows while preserving inline editing behavior.
- 2026-02-16 — Validation status for these changes: `npm run typecheck` ✅, `npm run build` ✅, `npm test` ✅ (384/384), and targeted lint on changed files via `npx eslint components/dashboard/analytics-crm-table.tsx actions/analytics-actions.ts` ✅.
- 2026-02-16 — Locked remaining human decisions: production index canary allowed, full CRM row virtualization scope, table-backed precompute strategy, and fixed latency evidence protocol (`8 cold + 8 warm` per endpoint).
- 2026-02-16 — Added additional backend latency reduction in `getAnalytics` breakdown flow by parallelizing independent read queries and adding `SET LOCAL statement_timeout = 5000` guard to per-setter response-time SQL (file: `actions/analytics-actions.ts`).
- 2026-02-16 — Added deterministic canary probe utility `scripts/analytics-canary-probe.ts` for 157f/157g evidence capture, including endpoint-level status/cache/duration/request-id summaries and cold/warm sampling controls.
- 2026-02-16 — Ran full quality gates successfully on current tree: `npm run lint` (warnings-only), `npm run typecheck`, `npm run build`, `npm test` (387/387 pass).
- 2026-02-16 — Ran unauthenticated analytics read-route negative check with probe script (`test-results/analytics-probe-unauth.json`): all analytics endpoints returned `401` with request IDs, confirming unauth guard behavior.
- 2026-02-16 — Isolated production `GET /api/analytics/response-timing` `500` root cause using live request-id + filtered Vercel logs: Prisma `P2010` / Postgres `42883` (`operator does not exist: timestamp without time zone >= interval`) in response-timing raw SQL window arithmetic.
- 2026-02-16 — Patched `actions/response-timing-analytics-actions.ts` to explicitly cast window/date and interval-day params (`::timestamp`, `::int`) across all response-timing conversion/pending predicates to eliminate ambiguous parameter typing in Postgres prepared statements.
- 2026-02-16 — Added regression coverage in `lib/__tests__/response-timing-analytics-sql-typing.test.ts` and updated `lib/__tests__/response-timing-analytics.test.ts` to assert typed window predicates; validation: targeted tests ✅, `npm run typecheck` ✅, `npm run build` ✅.
- Remaining for full Phase 157 closure: production warm/cold p95 evidence packet (157a/157f), canary/rollback packet, and failure-mode/auth drills (157g).
