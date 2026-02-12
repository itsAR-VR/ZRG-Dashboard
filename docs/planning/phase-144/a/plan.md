# Phase 144a — Baseline Metrics + Hotspot Attribution

## Focus
Create a reproducible, evidence-backed baseline for dashboard performance before refactors begin.

## Inputs
- `docs/planning/phase-144/plan.md`
- Build artifacts under `.next/`
- Core dashboard files:
  - `app/page.tsx`
  - `components/dashboard/inbox-view.tsx`
  - `components/dashboard/sidebar.tsx`
  - `components/dashboard/action-station.tsx`
  - `components/dashboard/analytics-view.tsx`
  - `components/dashboard/settings-view.tsx`
  - `components/dashboard/insights-chat-sheet.tsx`

## Work
1. **Install bundle analyzer**: `npm install --save-dev @next/bundle-analyzer`. Configure in `next.config.mjs` behind `ANALYZE=true` env guard. Produce initial treemap as baseline artifact.
2. **Capture baseline payload metrics** from production build (`npm run build`):
   - Parse `.next/server/app/page/build-manifest.json` → list all `rootMainFiles` chunks
   - Measure each chunk: raw bytes (`wc -c`) AND gzip bytes (`gzip -9 -c file | wc -c`)
   - Baseline: 405KB raw / 123KB gzip (7 chunks). Target: <=92KB gzip (>=25% reduction).
   - Record polyfill chunk size separately (currently 112KB raw / 39KB gzip)
   - Record total `.next/static/chunks` size (currently ~3.1MB) — must not increase >5%
   - **Do NOT use `page_client-reference-manifest.js`** — it is a server-side module map, not client payload.
3. **Map dynamic imports to chunk sets**: Parse `.next/server/app/page/react-loadable-manifest.json` → map each `dynamic()` import in `app/page.tsx` to its lazy chunk set. Document byte cost of each lazy view.
4. **Produce complete LOC inventory** of all 24 `components/dashboard/*.tsx` files, sorted by size. Identify unlisted heavy components (e.g., `crm-drawer.tsx`, `followup-sequence-manager.tsx`, `confidence-control-plane.tsx`).
5. **Document React Query configuration**: Read `components/providers/query-provider.tsx` → record `staleTime`, `gcTime`, `refetchOnWindowFocus` defaults. Note: increasing `staleTime` globally from 0 to 30000ms could eliminate redundant refetches on view switches.
6. **Audit ALL polling/refresh sources**:
   - `inbox-view.tsx`: `POLLING_INTERVAL = 30000` (line 40), `refetchInterval` (line 326), Supabase realtime subscription (lines 791-836)
   - `sidebar.tsx`: `setInterval(fetchCounts, 30000)` (line 164)
   - `settings-view.tsx`: internal prefetch timer system (~lines 1423-1615)
   - Any other polling in `insights-chat-sheet.tsx`, `crm-drawer.tsx`, enrichment hooks
7. **Define and lock INP measurement protocol**:
   - Tool: Chrome DevTools Performance panel with 4x CPU slowdown
   - Sample size: N>=10 measurements per interaction
   - Report: p50 and p75 per interaction
   - Acceptable variance: +/-20ms
   - Hardware/environment: document exact machine, browser version, network profile
   - Interaction set: inbox conversation switch, action station compose/send, settings tab switch/save, analytics window/filter change
8. **Record baseline request volume**: Open dashboard with inbox view active. Record HTTP request count (excluding WebSocket frames) over a 5-minute idle session using Chrome DevTools Network tab or `performance.getEntriesByType("resource")`.
9. **Document multi-agent conflict state**: Run `git diff --name-only` for all files targeted by phase 144. Record which files have uncommitted changes from other phases.
10. Write baseline artifact with command evidence and exact file anchors.

## Output
- `docs/planning/phase-144/a/perf-baseline.md` containing:
  - entry chunk byte breakdown
  - hotspot inventory by category (bytes, polling, render churn, hydration)
  - measurement protocol for later comparison

## Handoff
Proceed to **144b** with a locked baseline and ordered hotspot list. Do not optimize blindly; every change in 144b must map to a baseline hotspot.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Captured production build payload metrics from `build-manifest.json` rootMainFiles.
  - Captured chunk footprint and dashboard LOC hotspot inventory.
  - Confirmed current query defaults/polling anchors in code.
  - Wrote baseline artifact: `docs/planning/phase-144/a/perf-baseline.md`.
- Commands run:
  - `npm run build` — pass
  - rootMainFiles sizing script — pass (122,932 gzip bytes total)
  - `du -sk .next/static/chunks` — pass (3260 KB)
  - `rg --files components/dashboard -g "*.tsx" | xargs wc -l | sort -nr` — pass
- Blockers:
  - Bundle analyzer is not configured yet, so chunk treemap attribution remains unavailable.
  - INP and 5-minute network-idle measurements require interactive browser protocol run.
- Next concrete steps:
  - Install/configure analyzer and capture treemap.
  - Run browser protocol for INP/request-count baselines.
