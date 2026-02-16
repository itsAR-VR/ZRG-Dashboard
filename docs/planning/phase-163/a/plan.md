# Phase 163a — Baseline Repro + Evidence Packet (Playwright + Logs)

## Focus
Create a deterministic baseline that demonstrates variance (fast vs slow) and captures enough metadata to attribute the slowdown to a specific layer (client churn vs server compute vs DB).

## Inputs
- Current production URLs (prod + preview as applicable)
- Existing read routes: `app/api/inbox/*`, `app/api/analytics/*`
- Existing timing helpers for analytics (`app/api/analytics/_helpers.ts`) as reference for inbox parity
- Phase overlap notes: `docs/planning/phase-161/plan.md`, `docs/planning/phase-155/plan.md`

## Work
1. Reproduce the slow/fast variance via Playwright:
   - Load `/` (Master Inbox)
   - Switch workspaces
   - Navigate to Analytics then back
   - Repeat N times
2. Capture evidence on every run:
   - network request list (endpoint, status, response headers)
   - key read endpoints duration/cache headers
   - browser console errors/warnings
3. Correlate with server-side logs:
   - use `x-request-id` as the join key
   - pull Supabase logs for timeouts or DB errors (if available)
4. Produce a single JSON “variance packet” artifact under `test-results/` describing:
   - p50/p95 server durations (from headers)
   - percent of cache hits
   - slowest endpoints per run
   - whether slowness clusters by endpoint, workspace, or navigation path

## Output
- `test-results/perf-variance-*.json` (new artifact format) plus a short summary written into the Phase 163 plan or subphase output notes.

## Handoff
Use the slowest endpoints and request IDs to drive 163b (observability parity) and 163c (backend fixes).

