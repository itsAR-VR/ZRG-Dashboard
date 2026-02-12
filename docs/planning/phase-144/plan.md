# Phase 144 — Whole-Dashboard Performance Acceleration (Bytes + INP)

## Purpose
Deliver measurable whole-dashboard speed gains by reducing initial client payload and interaction latency without regressing critical inbox/settings workflows.

## Context
Phase 137 improved UX resilience and correctness, but perceived speed remains limited by heavy client surfaces, frequent polling, and render churn. The dashboard is still dominated by large client components and recurring background refresh work.

Current measured baseline before this phase (RED TEAM corrected):
- `/page` rootMainFiles (from Turbopack `.next/server/app/page/build-manifest.json`): **405KB raw / 123KB gzipped** (7 chunks)
- Polyfill chunk: 112KB raw / 39KB gzipped (additional)
- `.next/static/chunks` total: ~3.1MB (48 files)
- **NOTE**: The original 227.9KB figure was from `page_client-reference-manifest.js` — a 10.7KB server-side module map that is never sent to browsers. That metric was invalid.
- `app/page.tsx` is now a thin server wrapper around a client dashboard shell loader.
- Large client surfaces:
  - `components/dashboard/settings-view.tsx` (9,129 LOC)
  - `components/dashboard/insights-chat-sheet.tsx` (1,945 LOC)
  - `components/dashboard/action-station.tsx` (1,430 LOC)
  - `components/dashboard/analytics-view.tsx` (1,355 LOC)
- Known churn sources:
  - inbox `refetchInterval: 30000` (30s) + Supabase realtime subscription in `inbox-view.tsx`
  - sidebar `setInterval(fetchCounts, 30000)` (30s) in `sidebar.tsx`
  - analytics multi-request fan-out
  - settings-view internal prefetch timer system
  - repeated list transformations and formatting in render paths
- No `@next/bundle-analyzer` installed — chunk attribution is currently impossible without it

Locked decisions from conversation:
- Scope: **whole dashboard**
- Risk posture: **aggressive**
- Acceptance gates: **both bytes + INP**
- Execution model: **three waves**

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 142 | Active | `components/dashboard/settings-view.tsx`, `actions/settings-actions.ts` | Treat settings refactors as conflict-prone; re-read latest file state before each edit and merge by symbol. |
| Phase 141 | Active | `components/dashboard/settings-view.tsx`, `actions/settings-actions.ts` | Avoid touching AI route-toggle logic while doing performance work; preserve existing behavior. |
| Phase 140 | Active | backend-only (prompt/evaluator semantics) | No direct UI overlap; phase 144 must NOT touch `lib/ai-drafts.ts`. |
| Phase 139 | Complete | backend-only (`lib/followup-engine.ts`, `lib/meeting-overseer.ts`) | No overlap; phase 139 is closed. |
| Phase 143 | Planned/Active docs | backend-only (`lib/inbound-post-process/*`) | No direct overlap with dashboard UI targets. |

`git status --porcelain` is multi-agent dirty; phase 144 must stay surgical and dashboard-focused.

## Objectives
* [ ] Install `@next/bundle-analyzer` and produce chunk attribution treemap.
* [ ] Establish reproducible baseline metrics using `build-manifest.json` rootMainFiles (raw + gzip) for payload, and a locked INP measurement protocol with defined tooling/sample size/hardware.
* [ ] Reduce rootMainFiles gzip transfer size from 123KB to <=92KB (>=25% reduction).
* [ ] Reduce interaction latency to INP p75 <=200ms for core dashboard interactions.
* [ ] Cut unnecessary polling/network churn while preserving functional freshness guarantees (inbox <=60s stale when tab focused).
* [ ] Reduce render churn in large list/chat surfaces without changing business behavior.
* [ ] Produce a verification packet with before/after evidence, rollout checks, and rollback criteria.

## Constraints
- No behavioral changes to AI pricing/cadence/overseer logic under active phases 140/141/143.
- **Phase 144 must NOT touch `lib/ai-drafts.ts`** — it is a 6-phase hot spot (phases 135, 138, 139, 140, 141, 143). No performance reason to modify it.
- All chunk size measurements must come from production build (`npm run build`), never dev server.
- Canonical production bundler for this phase is Webpack via `next build --webpack` (configured in `package.json`) because it reduced root payload for this repo vs Turbopack.
- Total `.next/static/chunks` must not increase by more than 5% from baseline (guard against chunk duplication from lazy loading).
- Avoid speculative abstractions; implement only what directly improves measured performance.
- Preserve critical workflows: inbox triage, message send/reply, settings persistence, analytics readability.
- Maintain WCAG-safe interaction states and keyboard behavior while optimizing.
- Use symbol-anchored edits in high-churn files (`settings-view`, `inbox-view`, `action-station`).
- If phases 141/142 are still active during 144c, skip settings-view structural splitting and document as deferred.
- Validate continuously with `npm run lint`, `npm run build`, and `npm run test`.
- If schema changes become necessary (not planned), run `npm run db:push` and document rationale.

## Success Criteria
- [ ] rootMainFiles gzip transfer size <=92KB (from 123KB baseline, >=25% reduction). Measured via `gzip -9 -c <chunk> | wc -c` for each file listed in the active build's `build-manifest.json` `rootMainFiles`.
- [ ] INP p75 <=200ms on core interaction set (measured with Chrome DevTools Performance panel, 4x CPU throttle, N>=10 samples per interaction):
  - inbox conversation switch
  - action station compose/send path
  - settings tab switch/save
  - analytics window/filter change
- [ ] HTTP request count (excluding WebSocket frames) reduced versus baseline in a 5-minute idle session with inbox view active.
- [ ] `npm run lint`, `npm run build`, and `npm run test` pass with no new errors introduced.
- [ ] No critical UX/a11y regressions in touched dashboard surfaces (verified via axe-core, keyboard navigation check).
- [ ] No new JavaScript errors in Vercel Analytics 48h post-deploy.
- [ ] `docs/planning/phase-144/review.md` maps all criteria to concrete evidence.

## Subphase Index
* a — Baseline Metrics + Hotspot Attribution
* b — Wave 1: Shell/Polling/Network Churn Reduction
* c — Wave 2: Sub-View Splitting + Dependency Optimization (reframed from top-level lazy loading, which is already done)
* d — Wave 3: Render-Churn Elimination + INP Tuning
* e — Verification, Rollout Guardrails, and Phase Review

## Repo Reality Check (RED TEAM)

- What exists today:
  - `app/page.tsx` is a server wrapper that renders `DashboardShellLoader`
  - `components/dashboard/dashboard-shell-loader.tsx` loads the client dashboard shell via `next/dynamic` with `ssr: false`
  - `components/dashboard/dashboard-shell.tsx` contains the full client dashboard shell implementation
  - `conversation-feed.tsx` already uses `@tanstack/react-virtual` for virtualized scrolling
  - `inbox-view.tsx` has both HTTP polling (30s `refetchInterval`) AND Supabase realtime subscriptions
  - `sidebar.tsx` has `setInterval(fetchCounts, 30000)` for count refresh
  - `@vercel/analytics` is installed in `app/layout.tsx` (collects Web Vitals including INP)
  - 24 total `components/dashboard/*.tsx` files exist; plan targets 9
  - No `@next/bundle-analyzer` in `package.json`
  - Next.js 16.0.7 with Turbopack for dev, webpack for production builds
- What the plan originally assumed (corrected):
  - ~~227.9KB entry JS from `page_client-reference-manifest.js`~~ → actually 405KB raw / 123KB gzip from `build-manifest.json` rootMainFiles
  - ~~Heavy views need lazy loading~~ → already behind `next/dynamic`; sub-view splitting is the real opportunity
  - ~~`npm run build -- --webpack` is invalid~~ → validated via Context7 + local build that Next.js 16 supports Webpack opt-out with `--webpack`
  - ~~settings-view.tsx is ~8812 LOC~~ → actually 9,129 LOC
- Verified touch points:
  - `app/page.tsx` (305 LOC) — dynamic imports at lines 15-37
  - `components/dashboard/inbox-view.tsx` (1,062 LOC) — POLLING_INTERVAL at line 40, refetchInterval at line 326
  - `components/dashboard/sidebar.tsx` (440 LOC) — setInterval at line 164
  - `components/dashboard/settings-view.tsx` (9,129 LOC) — prefetch timers ~lines 1423-1615
  - `components/dashboard/conversation-card.tsx` (232 LOC) — no React.memo, rendered in virtualizer
  - `components/dashboard/conversation-feed.tsx` (592 LOC) — @tanstack/react-virtual at line 22
  - `components/dashboard/action-station.tsx` (1,430 LOC) — filteredMessages/messageCounts useMemo ~lines 271-315
  - `components/dashboard/analytics-view.tsx` (1,355 LOC) — recharts import
  - `components/dashboard/insights-chat-sheet.tsx` (1,945 LOC) — react-markdown import

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
1. **Wrong baseline metric** → original 227.9KB figure was from server-side manifest (10.7KB file), not client bundle. Corrected to 405KB raw / 123KB gzip from `build-manifest.json`. Target recalibrated to <=92KB gzip.
2. **No bundle analyzer** → `@next/bundle-analyzer` not installed; 144c would operate blind without chunk attribution. Fix: install as devDependency in 144a.
3. **No INP measurement protocol** → plan said "measure INP" without tooling, sample size, or hardware spec. Fix: define in 144a (Chrome DevTools, 4x CPU throttle, N>=10, p50/p75).
4. **Top-level lazy loading already done** → `app/page.tsx` already wraps all 6 views in `next/dynamic`. 144c's primary proposed optimization is a no-op. Fix: reframe 144c around sub-view splitting, barrel elimination, dependency dedup.
5. **Bundler ambiguity** → Turbopack `rootMainFiles` stayed flat despite route-entry cuts. Webpack builds reduced `rootMainFiles` to ~117KB gzip, so phase 144 now standardizes on `next build --webpack` for production measurement and rollout.

### Missing or ambiguous requirements
- "Entry JS" was never defined (raw vs gzip? include polyfill?). Now defined: rootMainFiles gzip sum from `build-manifest.json`.
- "Request volume reduction" had no numeric target. Now defined: HTTP requests (excluding WebSocket) over 5-min idle session.
- No total bundle size guard. Now added: `.next/static/chunks` must not increase >5%.
- No freshness SLA. Now defined: inbox <=60s stale when tab focused.

### Multi-agent coordination
- `settings-view.tsx` is a 4-phase collision zone (136, 137, 141, 142) — structural refactoring deferred if 141/142 still active.
- `action-station.tsx` has uncommitted changes — must re-read before editing.
- `lib/ai-drafts.ts` touched by 6 phases — explicitly excluded from phase 144 scope.
- 40+ uncommitted files in working tree — phase 144 should use dedicated branch.

### Testing / validation
- No `npm run test` was in verification gates → now added.
- No functional smoke test checklist per wave → now added to 144b-d.
- No post-deploy monitoring → now added: Vercel Analytics Web Vitals 48h.
- "RAMS/a11y" was vague → replaced with axe-core + keyboard navigation checks.

### Missing cross-cutting concerns
- No Error Boundaries around dynamic imports → added to 144c.
- Supabase realtime not coordinated with polling changes → added to 144b.
- React Query global config not examined → added to 144a.
- SSR/RSC migration not considered → documented as follow-on phase candidate.

## Assumptions (Agent)

- Phase 144 should work on a dedicated git branch from HEAD to isolate from 40+ uncommitted files (confidence ~90%).
  - Mitigation: if branching is impractical, document which uncommitted changes are from other phases and which are from 144.
- `lib/ai-drafts.ts` has zero performance relevance for dashboard UI and is safe to exclude entirely (confidence ~95%).
  - Mitigation: if bundle analyzer reveals ai-drafts code in client chunks, that is a tree-shaking bug to fix in 144c without modifying ai-drafts.ts logic.
- Visibility-gating polling (pause when tab hidden, resume on focus) is safe for inbox freshness with 60s SLA (confidence ~92%).
  - Mitigation: if users report stale data, the immediate-fetch-on-resume pattern ensures <=1 polling interval of staleness.

## Open Questions (Need Human Input)

- [ ] **Dedicated git branch**: Should phase 144 work on a dedicated branch to isolate from 40+ uncommitted files? (confidence ~90%)
  - Why it matters: without it, before/after comparisons are contaminated by non-144 changes; builds include other phase work.
  - Current assumption: yes, branch from HEAD.

## Phase Summary (running)
- 2026-02-11 22:23 EST — Implemented wave1+wave3 performance hardening and partial wave2 insights splitting; added phase artifacts (`a/perf-baseline.md`, `b/wave1-delta.md`, `c/wave2-delta.md`, `d/wave3-delta.md`, `review.md`). Files: `components/dashboard/inbox-view.tsx`, `components/dashboard/sidebar.tsx`, `components/providers/query-provider.tsx`, `components/dashboard/conversation-card.tsx`, `components/dashboard/insights-view.tsx`.
- 2026-02-12 — Implemented shell/bootstrap deferral pass:
  - `app/page.tsx` converted to server wrapper that renders `DashboardShellLoader`
  - new client loader `components/dashboard/dashboard-shell-loader.tsx` uses `next/dynamic` (`ssr: false`)
  - moved dashboard implementation into `components/dashboard/dashboard-shell.tsx`
  - relocated `QueryProvider` and `UserProvider` from `app/layout.tsx` into dashboard shell only
  - deferred `Toaster` + `Analytics` via `components/providers/post-hydration-enhancements.tsx`
  - verification: `npm run build`, `npm run lint`, `npm run test` all pass
  - measurements:
    - Turbopack `rootMainFiles` gzip: `~122,697` (flat vs baseline)
    - Webpack `rootMainFiles` gzip: `117,240` (improved vs Turbopack)
    - `/page entryJSFiles` gzip: `75,370 -> 1,859`
- 2026-02-12 — Standardized build script to Webpack for phase-144 runtime-byte optimization:
  - `package.json` build now uses `next build --webpack`
  - Context7 source confirms Next.js 16 supports `--webpack` for production builds
  - Re-verified `npm run build`, `npm run lint`, `npm run test` after script update
- 2026-02-12 — Root-bundle attribution + blocker verification:
  - local manifest check: `clientModules touching rootMainFiles = 0`
  - implication: remaining root bytes are largely framework/runtime chunks, not dashboard feature modules
  - attempted analyzer install failed with `ENOTFOUND registry.npmjs.org` (environment network blocker)
- 2026-02-12 — Additional navigation hardening pass:
  - `components/dashboard/dashboard-shell.tsx`: retained only `active + previous` mounted views, added URL-sync no-op guards, and prefetch in-flight dedupe.
  - `components/dashboard/conversation-feed.tsx`: memoized feed export + stable virtualizer item keys.
  - `components/dashboard/inbox-view.tsx`: stabilized feed props and load-more callback to reduce parent-driven list rerenders.
  - `components/dashboard/sidebar.tsx`: added counts-fetch in-flight guard and memoized filter model.
  - `components/dashboard/settings-view.tsx`: moved workspace prompt-reset off `useLayoutEffect` and cached global admin status fetch.
  - verification:
    - `npm run lint` — pass (warnings only)
    - `npm run build` — pass
    - `npm run test` — pass (368/368)
    - `npm run test:ai-drafts` — pass (58/58)
    - `npm run test:ai-replay ...` (dry-run + live) — blocked (`P1001`, DB unreachable)
  - measurement:
    - `.next/build-manifest.json` `rootMainFiles` gzip: `117,241`
    - `.next/static/chunks`: `3064 KB`

## RED TEAM Wrap-Up (Terminus Maximus)

- Remaining hard gaps:
  - Bundle attribution is still missing (`@next/bundle-analyzer` install blocked by registry DNS/network).
  - INP p75 and 5-minute idle request-count protocol evidence is still missing.
  - Root payload target (`<=92KB gzip`) remains unmet at `117,240` bytes (Webpack baseline for this phase).
- Open decision for closure:
  - keep the strict `<=92KB rootMainFiles` gate and continue only after network/analyzer unblocks, OR
  - re-baseline success gate to runtime-influenced metrics (route-entry bytes + INP/request-count), since rootMainFiles is not app-module-driven in current evidence.
- Coordination risks:
  - `settings-view.tsx` + related settings actions remain high-conflict with active phases 141/142.
  - `action-station.tsx` is currently dirty from other concurrent work; this phase avoided touching it this turn.
- Decision for next implementation turn:
  - Prioritize analytics internal splitting + analyzer setup before further micro-optimizations.
- 2026-02-11 22:27 EST — Ran NTTAN gate for message-handling impact: `test:ai-drafts` passed; both `test:ai-replay` commands blocked by DB connectivity (`P1001`).
- 2026-02-11 22:31 EST — Attempted to install `@next/bundle-analyzer`; dependency still unavailable (`npm ls` empty). Analyzer-led attribution remains blocked for this turn.
- 2026-02-11 22:34 EST — Added additional wave-2 dynamic splitting inside `components/dashboard/analytics-view.tsx` (CRM + booking subpanels). Build/lint passed; Turbopack root payload remained near `122,932` gzip bytes.
- 2026-02-11 22:37 EST — Re-ran full suite after analytics-view split (`npm run test`): 361 passed, 0 failed.
- 2026-02-12 — Implemented navigation-latency optimization pass (focused on perceived speed while switching views):
  - Added proactive view-module prefetching by active-view heuristics in `components/dashboard/dashboard-shell.tsx`
  - Added intent-based prefetching from sidebar hover/focus (`onViewIntent`) in `components/dashboard/sidebar.tsx`
  - Added view-click prefetch path in dashboard shell (`handleViewChange`) to warm chunks before first paint of target view
  - Reduced unnecessary sidebar rerenders by skipping `setCounts` when inbox counts payload is unchanged
  - Verification: `npm run lint`, `npm run build`, `npm run test` all pass after patch
  - Measurement: Webpack `rootMainFiles` gzip remains `117,240` (unchanged), confirming this pass targets interaction latency more than root bytes
  - Sub-agent multi-checks (2 explorer agents) identified next high-value hotspots:
    - Settings hydration + integrations fan-out (`impeccable-optimize`, `impeccable-harden`, `impeccable-polish`)
    - Inbox list normalization / active-conversation callback churn (`impeccable-optimize`)
    - Follow-ups refresh flicker + derived list recomputation (`impeccable-polish`, `impeccable-adapt`)
- 2026-02-12 — Implemented follow-ups interaction smoothing pass:
  - `components/dashboard/follow-ups-view.tsx` now avoids full-screen loading spinner on every refresh (only on initial load/workspace switch)
  - memoized expensive derived collections (`groupedInstances`, `overdueTasks`, `todayTasks`)
  - converted task mutation handlers to functional state updates to reduce stale-closure churn during rapid actions
  - verification: `npm run lint`, `npm run test`, `npm run build` all pass
  - measurement: Webpack `rootMainFiles` gzip `117,241` (flat; expected because change targets interaction/render latency, not root runtime bytes)
- 2026-02-12 — RED TEAM status after cached-view pass:
  - Repeat-navigation performance is improved structurally (stateful view retention + inactive inbox network gating), but objective evidence for INP/request-count is still missing.
  - Root byte target remains unmet (`117,241` vs `<=92,000`), and analyzer remains blocked by network install failures.
  - Next proof step remains unchanged: capture protocol INP/request traces and decide whether to close with runtime-focused metrics or continue byte-reduction work.
- 2026-02-12 — RED TEAM status after navigation hardening pass:
  - Perceived view-switch latency should improve from reduced remount churn and list rerender suppression, but this remains unproven until INP traces are captured.
  - Root byte target remains unchanged (`117,241` gzip) confirming these changes target runtime responsiveness, not framework chunk size.
  - Analyzer + INP/request-count evidence are still the gating items for phase closure.
- 2026-02-12 — Implemented cached-view navigation acceleration:
  - `components/dashboard/dashboard-shell.tsx` now keeps opened views mounted (hidden when inactive) to avoid remount/reload on back-navigation
  - dashboard initial view/settings tab now initializes from URL params, reducing first-render mismatch work on deep links
  - `components/dashboard/inbox-view.tsx` now accepts `isActive` and disables query/realtime/polling while inactive to prevent background churn with retained mounts
  - verification:
    - `npm run lint` — pass (warnings only)
    - `npm run build` — pass
    - `npm run test` — pass (368/368)
    - `npm run test:ai-drafts` — pass (58/58)
    - both `test:ai-replay` commands — blocked (`P1001`, DB unreachable)
  - measurement:
    - Webpack `rootMainFiles` gzip `117,241` (flat; this pass optimizes repeat navigation latency rather than root runtime chunk bytes)
    - `.next/static/chunks` `3060 KB` (within guardrail)
- 2026-02-12 — Implemented nav/caching safety corrections after dual sub-agent review (2 explorers, <=5-agent cap):
  - coordination check:
    - `git status --short` confirms active concurrent work across phases 139-145
    - scanned `phase-134`..`phase-145`; no new overlap outside phase-144 dashboard performance scope
  - sub-agent findings addressed:
    - removed aggressive all-view warm prefetch (first-load contention risk)
    - fixed campaigns cache lock behavior to avoid partial-success null-data freeze
  - code changes:
    - `components/dashboard/dashboard-shell.tsx`
      - kept `MAX_RETAINED_VIEWS = 3` mounted-view LRU
      - removed broad delayed all-view warmup prefetch
      - retained intent/click + heuristic prefetch
    - `components/dashboard/analytics-view.tsx`
      - added `ANALYTICS_CACHE_TTL_MS = 90_000` with per-tab `fetchedAt` refs
      - cache short-circuit now requires fresh TTL (prevents indefinite stale lock)
      - campaigns cache key now sets only when all campaign-tab requests succeed
  - verification:
    - `npm run lint` — pass (warnings only)
    - `npm run test` — pass (372/372)
    - `npm run build -- --webpack` — pass
  - measurement:
    - Webpack `rootMainFiles` gzip `117,503`
    - `.next/static/chunks` `3068 KB`
- 2026-02-12 — RED TEAM status after nav/caching safety corrections:
  - improved correctness: campaigns analytics cache no longer locks partial-success null states.
  - improved startup safety: removed broad warmup prefetch that could contend with first-interaction resources.
  - unresolved closure gates remain:
    - `rootMainFiles` target still unmet (`117,503` vs `<=92,000`)
    - INP protocol evidence still missing
    - 5-minute idle HTTP request-count evidence still missing
- 2026-02-12 — Live idle attribution + polling cadence reduction:
  - live Playwright capture on `https://zrg-dashboard.vercel.app` (Master Inbox, focused idle) recorded:
    - duration `5.21` minutes
    - `25` non-static requests (`4.8/min`)
    - all requests were `POST /` Next server-action calls
    - dominant action IDs: `4047...` (`11`), `4064...` (`10`), `6043...` (`3`), `4074...` (`1`)
  - sampled payload mapping:
    - `4064...` -> inbox list cursor/filter refresh payload
    - `4047...` -> client-id-only inbox counts payload
    - `6043...` -> single-lead conversation payload
  - code changes:
    - `components/dashboard/inbox-view.tsx`: `POLLING_INTERVAL` `30000 -> 60000`
    - `components/dashboard/sidebar.tsx`: counts interval `30000 -> 60000`
    - `components/dashboard/sidebar.tsx`: logo path normalization now decodes before encoding to prevent `%2520` double-encoded asset paths
  - verification:
    - `npm run lint` — pass (warnings only)
    - `npm run build` — pass
    - `npm run test` — pass (`372/372`)
    - `npm run test:ai-drafts` — pass (`58/58`)
    - `npm run test:ai-replay -- --client-id 00000000-0000-0000-0000-000000000000 --dry-run --limit 20` — fail (`No replay cases selected`)
    - `npm run test:ai-replay -- --client-id 00000000-0000-0000-0000-000000000000 --limit 20 --concurrency 3` — fail (`No replay cases selected`)
  - updated gate interpretation:
    - idle request-count evidence now exists and identifies concrete high-frequency action loops
    - INP protocol evidence remains missing
    - root payload target remains unmet (`117,503` vs `<=92,000`)
