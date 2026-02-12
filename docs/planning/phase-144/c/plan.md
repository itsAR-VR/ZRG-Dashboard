# Phase 144c — Wave 2: Sub-View Splitting + Dependency Optimization

## Focus
Cut initial payload by splitting heavy sub-components within already-lazy views, eliminating barrel exports, and deduplicating shared dependencies across chunks.

**Key context**: Top-level lazy loading is already implemented — `app/page.tsx` wraps all 6 views in `next/dynamic`. This wave targets the NEXT layer of optimization.

## Inputs
- `docs/planning/phase-144/a/perf-baseline.md` (bundle analyzer treemap, chunk-to-view mapping)
- `docs/planning/phase-144/b/wave1-delta.md`
- `app/page.tsx`
- Heavy dashboard surfaces:
  - `components/dashboard/analytics-view.tsx` (1,355 LOC — imports recharts)
  - `components/dashboard/insights-chat-sheet.tsx` (1,945 LOC — imports react-markdown, remark-gfm)
  - `components/dashboard/settings-view.tsx` (9,129 LOC — 4-phase collision zone)
  - `components/dashboard/action-station.tsx` (1,430 LOC — has uncommitted changes)

## Work
1. **Sub-component lazy loading within heavy views**:
   - Split `settings-view.tsx` tab panels into separate lazy-loaded sub-components (each settings tab becomes its own dynamic import within settings-view). **CAVEAT**: If phases 141/142 are still active, skip this split and document as deferred to avoid merge conflicts.
   - Make `insights-chat-sheet.tsx` itself a dynamic import within `insights-view.tsx` (currently a synchronous import; this defers react-markdown + remark-gfm loading until the chat sheet opens).
   - Split analytics chart panels within `analytics-view.tsx` to defer recharts loading until the analytics tab is actually viewed.
2. **Barrel export elimination for tree-shaking**:
   - Audit barrel exports in `components/ui/` — if `index.ts` re-exports all UI components, switch to direct imports.
   - Analyze Radix UI contribution to chunk sizes via bundle analyzer (21 @radix-ui packages installed). If internals are duplicated across chunks, evaluate shared chunk configuration.
3. **Dependency deduplication across lazy chunks**:
   - Identify shared dependencies that appear in multiple lazy chunks (e.g., date-fns, Radix primitives).
   - Configure webpack `splitChunks` in `next.config.mjs` if shared chunks would reduce total size.
4. **Add Error Boundaries around dynamic imports**:
   - Wrap each `dynamic()` import in `app/page.tsx` with error handling (either Next.js dynamic `error` option or React Error Boundary wrapper).
   - Error fallback: "Failed to load view. Click to retry." with a retry button that triggers re-import.
5. **Verify chunk graph after each step**:
   - Run `ANALYZE=true npm run build` after each partitioning step.
   - Detect regressions in rootMainFiles gzip sum.
   - Validate that view transitions still render correctly.
   - Confirm total `.next/static/chunks` has not increased >5% from baseline.
6. Ensure no behavior changes in active-phase-overlap logic (settings toggles, AI pipeline semantics).
7. **Recalculate rootMainFiles gzip** against <=92KB target trajectory.

## Validation (RED TEAM)

- [ ] `ANALYZE=true npm run build` produces treemap showing reduced entry chunks
- [ ] rootMainFiles gzip sum is lower than pre-144c measurement
- [ ] Total `.next/static/chunks` has not increased >5%
- [ ] Each view still renders correctly after lazy boundary changes
- [ ] Settings view preserves all toggle/save behavior from phases 141/142
- [ ] Error boundaries display fallback on simulated chunk load failure

## Output
- Refactored sub-view module boundaries and lazy loading within heavy dashboard surfaces.
- Error Boundaries around dynamic imports.
- `docs/planning/phase-144/c/wave2-delta.md` with:
  - per-step chunk impact (rootMainFiles gzip before/after each change)
  - entry bundle trend vs <=92KB gzip target
  - barrel/dedup changes and their byte impact
  - defects found and resolved

## Handoff
Proceed to **144d** once entry payload reduction is demonstrated and view-switch UX remains stable.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Applied insights sub-view dynamic splitting in `components/dashboard/insights-view.tsx`.
  - Added loading fallbacks for split components.
  - Wrote delta artifact: `docs/planning/phase-144/c/wave2-delta.md`.
- Commands run:
  - `npm run build` — pass (post-change verification)
- Blockers:
  - Analyzer package/config is still missing; cannot attribute chunk winners/losers yet.
  - Analytics internal tab splitting remains pending.
- Next concrete steps:
  - Add analyzer and run `ANALYZE=true npm run build`.
  - Execute analytics tab-splitting pass.
