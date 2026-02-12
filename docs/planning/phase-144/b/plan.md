# Phase 144b — Wave 1: Shell/Polling/Network Churn Reduction

## Focus
Deliver immediate perceived-speed gains by reducing avoidable background work and initial shell contention.

## Inputs
- `docs/planning/phase-144/a/perf-baseline.md`
- `app/page.tsx`
- `components/dashboard/inbox-view.tsx`
- `components/dashboard/sidebar.tsx`
- `components/dashboard/analytics-view.tsx`
- `components/dashboard/action-station.tsx`

## Work
1. **Visibility-gate polling** (primary churn reduction):
   - Pattern: polling pauses when `document.visibilityState === 'hidden'`, resumes immediately on `visibilitychange` to `'visible'` with one immediate fetch before resuming the interval.
   - Apply to: `inbox-view.tsx` `refetchInterval` (line 326), `sidebar.tsx` `setInterval` (line 164).
   - Freshness SLA: inbox data must be no more than 60s stale when browser tab is focused. Background tabs have no freshness guarantee.
2. **Coordinate Supabase realtime with polling**:
   - `inbox-view.tsx` uses BOTH HTTP polling (30s) AND Supabase realtime subscriptions (lines 791-836).
   - If realtime is providing live updates, extend HTTP polling interval to 60s+ as a heartbeat fallback (rather than 30s redundant polling).
   - Test: verify new messages still appear within 5s when realtime is active.
3. **Evaluate settings-view prefetch timers**:
   - `settings-view.tsx` has internal prefetch scheduling (~lines 1423-1615) that runs timers on mount even when settings tab is not active.
   - Fix: gate prefetch timers to only run when the settings tab is the active view.
4. **Optimize shell-level loading sequence** (note: all 6 views already use `next/dynamic`, so this focuses on sub-shell work):
   - Ensure non-critical prefetches (analytics, enrichment) are deferred until after inbox view renders.
   - Evaluate adding `{ ssr: false }` to dynamic imports that don't benefit from server rendering.
   - Keep fallback UX stable while reducing main-thread pressure.
5. **Minimize unnecessary network fan-out on initial load**:
   - Evaluate React Query `staleTime` global setting (if currently 0, increase to 30000ms to prevent refetches on view switches).
   - Sequence or gate non-critical fetches.
6. **Re-measure** request volume and interaction smoothness against 144a baseline.
7. **Guard against staleness regressions**: verify inbox message arrival latency, sidebar count accuracy, settings data freshness.

## Validation (RED TEAM)

Functional smoke test after wave 1:
- [ ] Load dashboard — inbox view renders with conversations within 3s
- [ ] Switch to each view (followups, CRM, analytics, insights, settings) — each renders correctly
- [ ] Background the browser tab for 2 minutes, return — data refreshes within 5s
- [ ] Send a reply in action-station — send succeeds
- [ ] Verify sidebar counts update within 60s
- [ ] Verify new inbound message appears within 5s (realtime) or 60s (polling fallback)

## Output
- Updated dashboard shell/polling logic in targeted files.
- `docs/planning/phase-144/b/wave1-delta.md` with:
  - before/after request volume snapshot
  - before/after qualitative interaction notes
  - regressions found + fixes applied

## Handoff
Proceed to **144c** after request-churn reductions are verified and no critical freshness regressions remain.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented visibility/realtime-aware inbox polling behavior.
  - Implemented sidebar polling guardrails (workspace + inbox view + visibility).
  - Added React Query background refetch interval guard.
  - Added active conversation fetch dedupe to suppress redundant conversation fetches.
  - Wrote delta artifact: `docs/planning/phase-144/b/wave1-delta.md`.
- Commands run:
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass
  - `npm run test` — pass
- Blockers:
  - Formal 5-minute browser network capture still pending for quantitative before/after request counts.
- Next concrete steps:
  - Run controlled browser capture and append hard request-count evidence.
