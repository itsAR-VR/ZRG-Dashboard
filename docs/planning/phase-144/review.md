# Phase 144 Review (Running)

## Summary
Phase 144 now includes a root-shell/bootstrap refactor, a production bundler shift to Webpack, navigation-intent prefetching, and a cached-view navigation pass that preserves view state between switches while pausing inactive inbox network activity. Full closure criteria are still not met: the largest target (`rootMainFiles <= 92KB gzip`) remains unmet, and INP/request-count acceptance evidence is incomplete.

## Files Changed This Turn
- `components/providers/query-provider.tsx`
- `components/dashboard/inbox-view.tsx`
- `components/dashboard/follow-ups-view.tsx`
- `components/dashboard/sidebar.tsx`
- `components/dashboard/conversation-card.tsx`
- `components/dashboard/insights-view.tsx`
- `components/dashboard/analytics-view.tsx`
- `components/dashboard/dashboard-shell.tsx`
- `components/dashboard/dashboard-shell-loader.tsx`
- `app/page.tsx`
- `app/layout.tsx`
- `components/providers/post-hydration-enhancements.tsx`
- `package.json`
- `docs/planning/phase-144/a/perf-baseline.md`
- `docs/planning/phase-144/b/wave1-delta.md`
- `docs/planning/phase-144/c/wave2-delta.md`
- `docs/planning/phase-144/d/wave3-delta.md`

## Quality Gates
- `npm run lint` -> pass (warnings only)
- `npm run build` -> pass (`next build --webpack`)
- `npm run test` -> pass (368 tests, 0 failures)

## Success Criteria Mapping

| Criterion | Target | Current | Status |
|---|---|---|---|
| Root payload gzip (`rootMainFiles`) | <= 92KB | 117,241 bytes (Webpack) | FAIL |
| INP p75 | <= 200ms | Not yet measured in protocol | PARTIAL |
| 5-min idle HTTP requests (excluding WebSocket) | Reduced vs baseline | Not yet captured with controlled run | PARTIAL |
| Lint/build/test | All pass | Pass | PASS |
| No critical UX/a11y regression in touched surfaces | Verified | Limited code-level checks only, no formal axe run this turn | PARTIAL |

Supplemental metrics (not original gate, but user-perceived startup relevance):
- `/page entryJSFiles` gzip (`page_client-reference-manifest.js`, Turbopack path): **75,370 -> 1,859 bytes** after shell split + provider relocation.
- Turbopack vs Webpack root payload (`rootMainFiles`): **~122.7KB -> 117.2KB gzip**.

## Latest Delta (Navigation-Speed Pass)
- Added active-view heuristic prefetch + nav-hover/nav-focus intent prefetch for dashboard sub-views.
- Added click-path prefetch before view switch.
- Reduced periodic sidebar count refresh rerenders by skipping state updates when counts are unchanged.
- Smoothed Follow-ups refresh behavior by avoiding full-screen spinner on routine refresh and memoizing derived collections.
- Validation after this pass:
  - `npm run lint` -> pass (warnings only)
  - `npm run build` -> pass
  - `npm run test` -> pass (361 tests)
- Payload impact: root payload unchanged (`117,241` bytes gzip), which is expected because this pass targets first-switch interaction latency, not framework runtime chunk size.

## Latest Delta (Cached View + Active Inbox Gating)
- Added mounted-view retention in `components/dashboard/dashboard-shell.tsx`:
  - previously opened views stay mounted and hidden when inactive
  - repeat navigation avoids remount and state loss
  - initial active view/settings tab now derived from URL params on first render
- Added explicit activity gating in `components/dashboard/inbox-view.tsx`:
  - new `isActive` prop
  - inbox `useQuery`, `useInfiniteQuery`, polling interval, and realtime subscription are disabled while inbox is inactive
  - enables fast return-to-inbox with lower background churn
- Verification this turn:
  - `npm run lint` -> pass (warnings only)
  - `npm run build` -> pass
  - `npm run test` -> pass (368/368)
  - `npm run test:ai-drafts` -> pass (58/58)
  - `npm run test:ai-replay -- --client-id 00000000-0000-0000-0000-000000000000 --dry-run --limit 20` -> blocked (`P1001`, DB unreachable)
  - `npm run test:ai-replay -- --client-id 00000000-0000-0000-0000-000000000000 --limit 20 --concurrency 3` -> blocked (`P1001`, DB unreachable)
- Post-change metrics:
  - `.next/build-manifest.json` `rootMainFiles` gzip: `117,241` bytes
  - `.next/static/chunks` footprint: `3060 KB`

## Latest Delta (Navigation Hardening + Rerender Suppression)
- Reduced hidden-view background cost in `components/dashboard/dashboard-shell.tsx`:
  - mounted views now keep only `active + previous` instead of unbounded history
  - URL param sync now no-ops on unchanged state and avoids duplicate legacy lead-workspace lookups
  - dynamic prefetching now dedupes in-flight loaders
- Reduced inbox list rerender pressure:
  - `components/dashboard/conversation-feed.tsx` memoized export, stable defaults, and virtualizer `getItemKey`
  - `components/dashboard/inbox-view.tsx` stabilized `ConversationFeed` props and load-more callback identity
- Reduced sidebar polling churn:
  - `components/dashboard/sidebar.tsx` now guards overlapping count fetches and memoizes filter configuration
- Reduced settings mount-time synchronous work:
  - `components/dashboard/settings-view.tsx` moved workspace reset off `useLayoutEffect`
  - cached global admin status across workspace switches
- Verification this pass:
  - `npm run lint` -> pass (warnings only)
  - `npm run build` -> pass
  - `npm run test` -> pass (368/368)
  - `npm run test:ai-drafts` -> pass (58/58)
  - `npm run test:ai-replay -- --client-id 00000000-0000-0000-0000-000000000000 --dry-run --limit 20` -> blocked (`P1001`, DB unreachable)
  - `npm run test:ai-replay -- --client-id 00000000-0000-0000-0000-000000000000 --limit 20 --concurrency 3` -> blocked (`P1001`, DB unreachable)
- Post-change metrics:
  - `.next/build-manifest.json` `rootMainFiles` gzip: `117,241` bytes (unchanged)
  - `.next/static/chunks` footprint: `3064 KB`

## Why The Platform May Still Feel Similar
- Primary tracked metric (`rootMainFiles`) improved under Webpack but is still dominated by large framework/runtime chunks.
- Local manifest check indicates page client modules are not mapped to rootMainFiles (`touching_rootMainFiles = 0`), reinforcing that app-level code cuts have limited effect on this specific metric.
- The new shell/bootstrap changes significantly reduced route-entry JS, but perceived speed depends on network/CPU and when deferred chunks hydrate.
- Most earlier gains were churn reductions (background polling/redundant fetches) and rerender suppression; these improve stability and CPU/network load more than obvious first-load speed.
- The latest pass improves chunk warm-up and reduces avoidable sidebar rerenders, but without INP and interaction timing captures the improvement can be hard to quantify yet.
- Analyzer-led attribution is still pending to determine what can actually move `rootMainFiles`.

## Rollback / Guardrails
Use configured phase thresholds when deploying these changes:
- rollback if INP p75 worsens >50ms vs pre-deploy baseline
- rollback if LCP p75 worsens >200ms
- rollback on critical flow failure (inbox load, send message, save settings)

## Next Actions To Reach Close
1. Add `@next/bundle-analyzer` when network access is available, run `ANALYZE=true npm run build`, and attribute biggest `rootMainFiles` contributors.
2. Capture protocol-based INP and 5-minute idle request-count evidence to quantify the new navigation-prefetch behavior.
3. Run explicit a11y checks (axe + keyboard navigation) for touched areas.
4. Execute next high-value optimizations from sub-agent audit:
   - settings hydration/fan-out deferral
   - inbox conversation normalization churn reduction
   - follow-ups derived-list memoization + virtualization

## Context7 Verification (This Turn)
- Next.js 16 docs (Context7 `/vercel/next.js/v16.0.3`) confirm:
  - `next build --webpack` is supported to opt out of Turbopack for production builds.
  - `@next/bundle-analyzer` setup via `ANALYZE=true` + next config wrapper.
- Environment blocker:
  - `npm install --save-dev @next/bundle-analyzer` failed with `ENOTFOUND registry.npmjs.org`, so analyzer output could not be generated in this environment.

## Agentic Impact Classification (Prior Turn)
- This turn touched only frontend shell/loading/build config and phase docs.
- No AI drafting/prompt/message/reply/webhook/cron reply logic was modified.
- NTTAN validation gate not required for this turn.

## Agentic Impact Classification (Current Turn)
- This turn touched inbox message-handling surfaces (`components/dashboard/inbox-view.tsx`) and shell navigation (`components/dashboard/dashboard-shell.tsx`).
- NTTAN validation gate executed and recorded under blocked replay conditions (DB connectivity).

## NTTAN Validation Gate (Message-Handling Impact)
- `npm run test:ai-drafts` -> PASS
- `npm run test:ai-replay -- --client-id 00000000-0000-0000-0000-000000000000 --dry-run --limit 20` -> BLOCKED (`P1001`, cannot reach Supabase database host)
- `npm run test:ai-replay -- --client-id 00000000-0000-0000-0000-000000000000 --limit 20 --concurrency 3` -> BLOCKED (`P1001`, cannot reach Supabase database host)
- Analyzer setup remains blocked in this turn: install attempt did not produce a usable dependency (`npm ls @next/bundle-analyzer --depth=0` returns empty).
- Additional wave-2 change applied: dynamic imports in `components/dashboard/analytics-view.tsx` for CRM and booking panels; verified with lint/build.
- Final-state regression verification re-run after analytics-view split: `npm run test` passed (361/361).

## Latest Delta (Nav/Caching Safety Corrections)
- Ran two focused explorer sub-agents (within 5-agent limit) on:
  - `components/dashboard/dashboard-shell.tsx`
  - `components/dashboard/analytics-view.tsx`
- High-risk findings addressed in-code:
  - removed broad all-view delayed warm prefetch (reduces initial load contention risk)
  - campaigns tab cache key now sets only when all campaign-tab requests succeed
  - added 90s TTL-backed cache freshness guard for analytics tab payloads to avoid indefinite stale locks
- Files changed in this delta:
  - `components/dashboard/dashboard-shell.tsx`
  - `components/dashboard/analytics-view.tsx`

### Verification (Post-fix)
- `npm run lint` -> pass (warnings only)
- `npm run test` -> pass (372 tests, 0 failures)
- `npm run build -- --webpack` -> pass

### Metrics (Post-fix)
- `.next/build-manifest.json` `rootMainFiles` gzip: `117,503` bytes
- `.next/static/chunks`: `3068 KB`

### Updated Interpretation
- This pass improved correctness and reduced first-load contention risk, but did not materially reduce root runtime bytes.
- Closure blockers are unchanged:
  - root payload target still fails (`117,503` vs `<=92,000`)
  - INP p75 evidence still missing
  - 5-minute idle request-count evidence still missing

## Latest Delta (Live Playwright Idle Traffic Attribution + Polling Reduction)
- Live environment capture (`https://zrg-dashboard.vercel.app`) on Master Inbox:
  - controlled idle run length: `5.21` minutes
  - non-static requests: `25` (`4.8/min`)
  - request shape: all `POST /` Next.js server-action calls
  - dominant action IDs:
    - `4047f2f67240bd11d1791bfeb6a4b7aaa683d346a3` (`11`)
    - `4064c1fbbbb0d620f8508228282abd391b3af36ad6` (`10`)
    - `60438852811b993944f03e77fb8cb1b99a5c9d8757` (`3`)
    - `4074ee2e41b8e7a32cac698e78e268e23e46407a75` (`1`)
  - payload mapping from sampled bodies:
    - `4064...` carries full inbox cursor/filter payload (conversation-list refresh)
    - `4047...` carries `["<clientId>"]` payload (workspace inbox counts refresh)
    - `6043...` carries `["<leadId>"]` payload (active conversation refresh path)
  - additional live finding: repeated logo request `GET /images/Founders%2520Club%2520Logo.svg` returns `404` (double-encoded `%25` path).
- Code changes for churn reduction:
  - `components/dashboard/inbox-view.tsx`
    - `POLLING_INTERVAL`: `30000 -> 60000`
  - `components/dashboard/sidebar.tsx`
    - counts refresh interval: `30000 -> 60000`
    - brand logo path normalization now decodes before encoding to prevent `%20 -> %2520` double-encoding 404s
- Expected effect (post-deploy):
  - roughly halves dominant focused-idle polling traffic from the two primary loops while preserving `<=60s` freshness SLA.
  - projected idle request rate after deploy: from ~`4.8/min` toward ~`2.5-3.0/min` in the same scenario.

### Verification (Post-change)
- `npm run lint` -> pass (warnings only)
- `npm run build` -> pass
- `npm run test` -> pass (`372` pass, `0` fail)
- `rootMainFiles` gzip (post-build, Webpack): `117,239` bytes
- `.next/static/chunks`: `3068 KB`

### NTTAN Validation Gate (Message-Handling Impact, current run)
- `npm run test:ai-drafts` -> PASS (`58/58`)
- `npm run test:ai-replay -- --client-id 00000000-0000-0000-0000-000000000000 --dry-run --limit 20` -> FAIL (no replay cases selected for sentinel client id)
- `npm run test:ai-replay -- --client-id 00000000-0000-0000-0000-000000000000 --limit 20 --concurrency 3` -> FAIL (no replay cases selected for sentinel client id)
- Note: previous DB connectivity blocker (`P1001`) is no longer present in this environment; replay failures are dataset-selection failures for the dummy client ID.

### Updated Interpretation
- 5-minute idle request-count evidence is now captured and attributed to concrete action loops.
- INP p75 evidence remains missing (still open).
- Root payload target remains unmet (`117,503` vs `<=92,000`).
