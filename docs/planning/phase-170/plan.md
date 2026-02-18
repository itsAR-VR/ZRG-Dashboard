# Phase 170 — Analytics + Inbox + Settings Performance Hardening (20-Iteration Loop)

## Purpose
Execute a code-first, multi-user performance hardening phase across Analytics, Master Inbox, and Settings with at least 20 measured optimization iterations, and deliver architecture changes that improve scalability without over-engineering.

## Context
The platform currently shows inconsistent latency (sometimes fast, sometimes slow), with Analytics called out as the biggest recurring issue. Existing phases already improved timeout resilience and cron/webhook offload, but read-path and UI hydration costs still need a dedicated closure loop focused on:
- duplicate passes (auth/cache/query)
- high-variance query paths under concurrency
- oversized settings hydration payloads
- repeatable verification across sections and load levels

This phase prioritizes code-level analysis and remediation first, using Playwright/live checks as secondary verification.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 169 | Active | Shared runtime surfaces and perf evidence context (`analytics`/`inbox` adjacent + cron contention context) | Do not modify cron/webhook offload contracts or `*_USE_INNGEST` rollout semantics in this phase. Re-read shared files before edits. |
| Phase 168 | Complete (`partially confirmed`) | Same platform-speed objective and baseline artifacts | Reuse Phase 168 baseline packets; Phase 170 extends closure to read-path + UI hydration architecture. |
| Phase 167 | Active | Timeout/perf hardening context | Keep fixes additive and avoid reintroducing inline heavy execution on request paths. |
| Working tree | Active | Existing uncommitted edits under `docs/planning/phase-169/*` and `End2End.md` | Keep Phase 170 scoped to new planning docs and explicit implementation files only. |

## Objectives
* [x] Produce a code-grounded hotspot map for Analytics, Inbox, and Settings with ranked root causes.
* [x] Remove redundant request work (duplicate auth/caching/query passes) on critical read paths.
* [ ] Improve query and hydration behavior for stable p95 under multi-user concurrency.
* [x] Run and document at least 20 explicit optimization/verification iterations across sections.
* [ ] Deliver rollout-safe architecture changes and regression guardrails for enterprise-scale growth.

## Constraints
- Code-first investigation is mandatory; Playwright/live UI runs are secondary verification.
- Avoid over-engineering; prefer surgical removals of duplicate work and high-impact bottlenecks.
- Preserve auth, tenant isolation, and existing fail-open safety semantics for read APIs.
- Keep cron/webhook offload behavior (Phase 169) untouched unless explicitly coordinated.
- No destructive operations; no secrets/tokens/PII in artifacts.
- If Prisma schema changes are introduced, run `npm run db:push` against the correct DB before closeout.
- Human override for NTTAN in this phase: run NTTAN once at phase end only (single replay pass), not during intermediate subphases.

## Success Criteria
- A 20-iteration log exists with per-iteration scope, change, and before/after metrics (`docs/planning/phase-170/artifacts/iteration-log.md`).
- Analytics, Inbox, and Settings each have explicit p95 targets and measured closure windows:
  - Analytics read paths: warm p95 `< 1.5s`, cold p95 `< 3.0s`
  - Inbox counts/conversations: p95 `< 2.0s` and `< 3.0s` respectively
  - Settings initial load/hydration path: p95 `< 2.5s` for settings payload fetch and no repeated heavy slice refetch loops
- Duplicate-pass reductions are implemented and verified (auth/cache/query), with no behavior regression.
- Multi-user concurrency checks (staged load levels) show stable latency and no error-rate spikes.
- Observability packet exists at `docs/planning/phase-170/artifacts/observability-packet.md` with:
  - endpoint histograms (p50/p95/max)
  - status/error-rate trends
  - pass/fail judgement against success criteria
- Required validation gates pass:
  - `npm run lint`
  - `npm run build`
  - `npm test`
  - `npm run test:ai-drafts` (only where message/reply logic is touched)
  - End-of-phase only (single replay pass):
    - Preferred: `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-170/replay-case-manifest.json --concurrency 3`
    - Fallback when manifest is unavailable: `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`

## Subphase Index
* a — Code Hotspot Baseline + Budget Contract (Analytics/Inbox/Settings)
* b — Analytics Read-Path De-duplication + Query/Caching Hardening
* c — Master Inbox Throughput Hardening (Search/Cursor/Reply-State)
* d — Settings Hydration + Accessibility/UX Performance Hardening
* e — 20-Iteration Cross-Section Verification Loop + Multi-User Load Runs
* f — Architecture Finalization, Rollout Guardrails, and Closeout Packet

## Phase Summary (running)

### 2026-02-18

- Completed subphase `170a` baseline artifacts:
  - `docs/planning/phase-170/artifacts/hotspot-baseline.md`
  - `docs/planning/phase-170/artifacts/iteration-log.md` (30 explicit iterations)
- Implemented low-risk hardening across all requested sections:
  - Analytics:
    - Route cache authority for overview miss path.
    - Campaigns route branch isolation with timeout guards.
    - Removed duplicate fallback behavior for non-OK read-API responses while preserving transport-error fail-open.
  - Master Inbox:
    - Reduced reply-state scan amplification.
    - Improved first-page cache strategy for conversations.
    - Increased counts cache TTL for lower recompute churn.
  - Settings:
    - Added lightweight settings fetch mode (optional knowledge-assets inclusion).
    - Deferred knowledge-asset hydration to AI tab.
    - Applied lightweight settings fetch in CRM drawer and follow-up manager.
- Validation completed:
  - `npx eslint ...` (no errors; existing warnings remain)
  - `npm run build` (pass)
- Red-team follow-up:
  - Explorer review found a resilience regression in analytics read helpers.
  - Patched to restore transport-error action fallback while keeping non-OK route responses non-duplicative.
  - Revalidated with lint/build.
- Additional closure work:
  - Added explicit staged load matrix + observability packet scaffolding (`artifacts/load-checks.md`, `artifacts/observability-packet.md`).
  - Added executable staged load harness (`scripts/staged-read-load-check.ts`) + npm probe scripts.
  - Added settings perf canary (`e2e/settings-perf.spec.mjs`).
  - Removed one redundant settings bootstrap admin-status request and parallelized calendar links fetch in initial settings load.
  - Parallelized CRM-row enrichment stats queries and conditionalized response-mode derivation query to reduce repeated scans.
  - Validation rerun complete:
    - `npm run lint` (warnings only)
    - `npm test` (pass)
    - `npm run build` (pass)
    - Playwright perf canaries executed but skipped without authenticated storage state.
- Founders Club analytics regression deep-dive (MCP live session):
  - Reproduced `403 Unauthorized` on analytics read endpoints for `clientId=ef824aca-a3c9-4cde-b51f-2e421ebb6b6e` while inbox endpoints for the same workspace stayed `200`.
  - Ran a 20-iteration MCP probe (160 total requests across analytics/inbox endpoints):
    - Analytics overview/workflows/campaigns/crm-summary: 100% `403 Unauthorized`.
    - Response timing: 100% `500 Failed to fetch response timing analytics`.
    - Inbox counts/conversations: 100% `200`.
  - Implemented analytics authorization unification to match platform scope semantics:
    - Replaced owner/member-only checks with shared `getAccessibleClientIdsForUser` scope resolution.
    - Updated analytics SQL scope helper to support explicit client ID lists (including super-admin all-client scopes).
    - Removed duplicate per-setter access query pass (trusted upstream auth guard) to reduce overhead.
  - Hardened analytics UX + edge-case math:
    - Overview now surfaces explicit load/auth errors instead of incorrectly showing `No analytics data yet`.
    - Fixed daily chart window boundary handling for exclusive end dates to prevent zero-day collapses.
  - Added regression guard test: `lib/__tests__/analytics-actions-scope.test.ts`.
  - Validation rerun after patch:
    - `npm run lint` (warnings only, no errors)
    - `node --import tsx --test lib/__tests__/analytics-actions-scope.test.ts` (pass)
    - `npm run typecheck` (pass)
    - `npm run build` (pass)
- Response-timing 500 root cause (Founders Club):
  - Ran production SQL repro against Founders Club dataset and confirmed deterministic failure:
    - `ERROR: integer out of range` from `(extract(epoch from (ai_response_sent_at - ai_scheduled_run_at)) * 1000)::int`
  - Founders Club has extreme AI drift outliers (`max_drift_ms=1770316499000`), which overflow `int` and caused endpoint-wide failure.
  - Implemented fix in `actions/response-timing-analytics-actions.ts`:
    - Cast drift to `bigint` instead of `int`.
    - Added explicit Prisma interactive transaction budget (`timeout: 15000`, `maxWait: 5000`) for heavy analytics reads.
  - Added regression guard: `lib/__tests__/response-timing-analytics-guards.test.ts`.
  - Validation rerun after fix:
    - `node --import tsx --test lib/__tests__/analytics-actions-scope.test.ts lib/__tests__/response-timing-analytics-guards.test.ts` (pass)
    - `npm run typecheck` (pass)
    - `npm run lint` (warnings only, no errors)
    - `npm test` (pass)
    - `npm run build` (pass)
- Deeper architecture hardening (read-path duplicate-auth elimination):
  - Attempted additional parallel explorer sub-agent passes; blocked by active agent-thread cap (`max 6`), so completed manual deep audit.
  - Implemented route-auth pass-through (`authUser`) from read APIs into analytics actions to remove repeated Supabase auth calls on hot read paths:
    - Updated routes: overview, workflows, campaigns, crm rows/summary, response-timing.
    - Updated actions to accept pre-authenticated context while preserving secure fallback when called directly as server actions.
  - Added response-timing scoped resolver for pre-authenticated context without changing workspace access semantics.
  - Improved error semantics so auth failures stay `Not authenticated`/`Unauthorized` instead of collapsing into generic `500` messages in key analytics actions.
  - Added guard coverage:
    - `lib/__tests__/analytics-read-route-auth-pass-through.test.ts`
    - expanded `lib/__tests__/analytics-actions-scope.test.ts` auth-semantics assertion
  - Validation rerun:
    - `node --import tsx --test lib/__tests__/analytics-actions-scope.test.ts lib/__tests__/response-timing-analytics-guards.test.ts lib/__tests__/analytics-read-route-auth-pass-through.test.ts` (pass)
    - `npm run typecheck` (pass)
    - `npm run lint` (warnings only, no errors)
    - `npm run build` (pass)
    - `npm test` (pass)
- Platform hardening beyond analytics (inbox/admin/test routes):
  - Added shared timing-safe route secret verification helper: `lib/api-secret-auth.ts`.
  - Removed duplicated secret parsing/comparison logic across:
    - `app/api/admin/workspaces/route.ts`
    - `app/api/admin/workspaces/bootstrap/route.ts`
    - `app/api/admin/workspaces/members/route.ts`
  - Hardened `app/api/webhooks/ghl/test/route.ts`:
    - now requires admin/provisioning secret for both `GET` and `POST`.
    - prevents unauthenticated workspace metadata disclosure.
  - Inbox read API auth/consistency hardening:
    - route-auth pass-through added for `counts`, `conversations`, and `conversations/[leadId]`.
    - counts route now enforces strict auth error propagation instead of silently returning empty counts on auth failures.
    - actions support optional pre-authenticated context to avoid duplicate auth passes.
  - Added regression guards:
    - `lib/__tests__/admin-route-secret-hardening.test.ts`
    - `lib/__tests__/inbox-read-route-auth-pass-through.test.ts`

## RED TEAM Open Items

1. Staged load tooling + explicit band matrix added; execution evidence capture in progress (`artifacts/load-checks.*`).
2. CRM SQL-heavy row enrichment remains candidate for further query-shape/index tuning under authenticated staged load bands.
3. Observability packet template added; fill with command outputs before phase close.
