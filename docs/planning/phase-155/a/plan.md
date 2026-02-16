# Phase 155a — Merge + Deploy Phase 154 Read Path with Server-Runtime Flags + Canary

## Focus
Land Phase 154 read-path work safely in `main`, convert client build-time flags to server-runtime flags, and execute a controlled canary rollout with immediate rollback ability.

## Inputs
- Phase 154 code on `phase-154`.
- Existing read APIs:
  - `app/api/inbox/*`
  - `app/api/analytics/overview/route.ts`
- Current client flag usage:
  - `components/dashboard/inbox-view.tsx`
  - `components/dashboard/sidebar.tsx`
  - `components/dashboard/analytics-view.tsx`
- Redis env vars:
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`

## Work
1. **Pre-flight**
   - Confirm Phase 154 subphases are complete and merged into rollout branch.
   - Run: `npm run lint && npm run typecheck && npm run build && npm test`.
   - Verify no open regressions from Phase 153 workspace UX behavior.

2. **Convert feature flags to server-runtime evaluation**
   - Add centralized server flag helper (`lib/feature-flags.ts`).
   - Evaluate flags in API routes/server actions, not at client module top-level.
   - Keep `NEXT_PUBLIC_*` values as compatibility inputs, but expose resolved booleans via server response shape.
   - Ensure flag changes take effect without rebuild/redeploy.

3. **Legacy fallback policy (one release cycle)**
   - Keep legacy read implementation callable behind runtime kill switch.
   - New path failure automatically fails open to legacy reads.
   - Add lightweight structured log event when fallback is used.

4. **Canary rollout**
   - Stage 1: 5% traffic.
   - Stage 2: 25% traffic.
   - Stage 3: 100% traffic.
   - Hold 30 minutes at each stage with monitoring gates.

5. **Monitoring and gates**
   - Track:
     - 401/403 rates
     - read API error rate
     - cache hit rate
     - React dashboard crash/error-boundary rate
   - Stop and rollback on gate breach.

6. **Rollback**
   - Flip runtime flag off (no redeploy).
   - Keep Redis enabled; it is non-blocking.
   - Record rollback reason and metric snapshot.

## Validation
- Runtime flag flip is effective immediately in preview and production.
- Fallback path works when forcing read API failure.
- Canary progresses 5% → 25% → 100% with no gate breach.
- Phase 153 parity checks pass (no stacked layout, no stuck spinner, URL state intact).

## Output
- Phase 154 read-path work is live in `main` with instant rollback controls.
- Legacy read fallback is retained for one release cycle.
- Canary logs and gate outcomes are documented.

## Handoff
Proceed to Phase 155b for counts materialization and near-real-time freshness.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented server-runtime feature-flag helper in `lib/feature-flags.ts` to avoid client build-time-only toggles.
  - Gated read API routes with runtime flags and explicit disabled response (`READ_API_DISABLED`) in:
    - `app/api/inbox/counts/route.ts`
    - `app/api/inbox/conversations/route.ts`
    - `app/api/inbox/conversations/[leadId]/route.ts`
    - `app/api/analytics/overview/route.ts`
  - Removed client compile-time read-path flag branching and switched to API-first + server-disabled fallback in:
    - `components/dashboard/inbox-view.tsx`
    - `components/dashboard/sidebar.tsx`
    - `components/dashboard/analytics-view.tsx`
  - Multi-agent coordination check: recent overlaps found with phases 149/152/153/154 on `inbox-view.tsx`, `sidebar.tsx`, `analytics-view.tsx`; edits were kept surgical to read-path gating only (no workspace transition logic rewrite).
- Commands run:
  - `npm run lint` — pass (warnings only; pre-existing warnings remain).
  - `npm run typecheck` — pass.
  - `npm run build` — pass.
  - `git status --porcelain` — pass; only intended Phase 155 docs/code touched.
  - `ls -dt docs/planning/phase-* | head -10` — pass; overlap scan completed.
- Blockers:
  - Deployment/canary verification steps (5% → 25% → 100%) are not executable from local-only context this turn.
  - Runtime flag flip validation in preview/prod requires Vercel environment access.
- Next concrete steps:
  - Continue Phase 155b implementation (`InboxCounts`/`InboxCountsDirty` + dirty marking + recompute path).
  - After code-level subphases are landed, run Vercel canary checklist for Phase 155a rollout closure.
  - RED TEAM carry-forward: analytics tabs beyond overview still rely on Server Actions (expected until Phase 155d), and rollout evidence is pending preview/prod access.

## Incident Carry-Forward (2026-02-16)
- Production verification exposed a fail-closed runtime-flag outage:
  - `/api/analytics/*` and `/api/inbox/*` returned `READ_API_DISABLED` with `x-zrg-read-api-enabled: 0`.
  - Root cause is runtime env drift combined with default-disabled behavior in flag resolution.
- Carry-forward remediation for 155a closure:
  1. Apply production env recovery (`NEXT_PUBLIC_ANALYTICS_READ_API_V1=true`, `NEXT_PUBLIC_INBOX_READ_API_V1=true`) and redeploy.
  2. Harden flag policy to production-safe default ON with explicit-disable semantics.
  3. Add disabled-route telemetry/alerts to stop silent regression.
