# Phase 137c — Performance Optimization Blueprint

Date: 2026-02-11
Inputs:
- `docs/planning/phase-137/a/baseline-audit-dossier.md`
- `docs/planning/phase-137/b/ux-architecture-refinement-spec.md`

## Objective
Reduce dashboard startup and interaction cost with measurable budgets and low-risk optimization slices that preserve behavior.

## Baseline Bottlenecks
1. Large dashboard route payload before splitting:
   - Largest chunks observed: ~754KB and ~718KB.
2. High coupling at route composition (`app/page.tsx`) with eager imports for all major views.
3. Hook-dependency lint warnings in critical interaction paths.
4. Polling/effect churn in sidebar and inbox contexts.

## Performance Budgets (Proposed for Phase 137)
- Route composition:
  - Largest individual JS chunk < 400KB in production build output.
  - Top-2 chunk combined size reduced by at least 25% vs baseline.
- Interaction:
  - No additional lint hook warnings introduced in dashboard core files.
  - Net warning count trending downward on each optimization slice.
- Runtime behavior:
  - No regressions in workspace switching and inbox rendering.

## Implemented in This Subphase

### Slice C1 — Route-level code splitting for heavy views
- File: `app/page.tsx`
- Change:
  - Converted eager imports of `InboxView`, `FollowUpsView`, `CRMView`, `AnalyticsView`, `InsightsView`, and `SettingsView` to dynamic imports.
- Expected impact:
  - Reduced entry payload concentration by deferring non-active views.

### Slice C2 — Effect stability for workspace sync
- File: `app/page.tsx`
- Change:
  - Wrapped `syncWorkspaces` in `useCallback` and updated effect deps.
- Expected impact:
  - Removed stale dependency warning and stabilized workspace fetch effect semantics.

### Slice C3 — Sidebar polling effect hardening for render stability
- File: `components/dashboard/sidebar.tsx`
- Change:
  - Added refs to track first fetch and workspace transitions without dependency churn.
- Expected impact:
  - Preserves periodic refresh while avoiding effect dependency warning and reducing loading-state thrash.

## Measurement Delta (Current)
- Lint warning count:
  - Baseline: 23 warnings
  - Current: 21 warnings
  - Delta: -2 warnings
- Largest chunk distribution:
  - Baseline top chunks: ~754KB / ~718KB
  - Current top chunks: ~370KB / ~365KB
  - Approximate top-chunk reduction: ~50% for each of the two largest chunks

## Next Optimization Queue
1. Split heavy Settings advanced editors/history panes behind explicit lazy boundaries.
2. Reduce Action Station effect/dependency warnings.
3. Normalize CSS token patterns causing optimizer warnings.
4. Introduce activity-aware polling gates for low-value background refreshes.

## Verification Commands
- `npm run lint`
- `npm run build -- --webpack`
- `find .next/static/chunks -type f -name '*.js' -print0 | xargs -0 ls -lh | sort -k5 -hr | head`

## Risk Controls
- No schema or API contract changes.
- No behavior changes to permissions/admin gating.
- All changes verified through lint/build before advancing.
- Next.js 16 platform note tracked: `middleware` -> `proxy` migration should be handled as a separate compatibility slice (codemod available).
