# Phase 137c — Performance Optimization Blueprint (Load + Render + Motion)

## Focus
Improve loading speed and interaction smoothness in user-critical dashboard surfaces using measured bottlenecks and high-impact fixes first.

## Inputs
- `docs/planning/phase-137/a/plan.md` performance baseline
- `docs/planning/phase-137/b/plan.md` IA refinements
- High-complexity components:
  - `components/dashboard/settings-view.tsx`
  - `components/dashboard/inbox-view.tsx`
  - `components/dashboard/action-station.tsx`
  - `components/dashboard/analytics-view.tsx`
  - `components/dashboard/crm-drawer.tsx`

## Work
1. Run `impeccable-optimize` against target surfaces and collect bottlenecks:
   - bundle and route chunk cost
   - hydration/client-work cost
   - avoidable re-renders and expensive list rendering
   - animation performance (transform/opacity vs layout properties)
2. Define and execute optimization slices:
   - split monolithic view modules where beneficial
   - defer non-critical panels/components
   - tighten data-fetch timing and reduce unnecessary refresh churn
   - improve perceived performance (progressive loading/skeleton clarity)
3. Establish measurable budgets and thresholds (per key surface).
4. Re-measure and compare before/after metrics.

## Output
- Completed performance blueprint and first optimization implementation:
  - `docs/planning/phase-137/c/performance-optimization-blueprint.md`
  - code updates:
    - `app/page.tsx`
    - `components/dashboard/sidebar.tsx`

## Handoff
Phase 137d should harden the modified surfaces (`app/page.tsx`, `components/dashboard/sidebar.tsx`) for edge-state resilience while preserving the current chunk and warning improvements.

## Validation (RED TEAM)
- `git status --porcelain` -> expected modified files only in active phase scope.
- `ls -dt docs/planning/phase-* | head -10` -> overlap scan run before code edits.
- `npm run lint` -> pass (warnings reduced 23 -> 21).
- `npm run build -- --webpack` -> pass.
- Chunk check:
  - Baseline top chunks (pre-split): ~754KB / ~718KB
  - Current top chunks: ~370KB / ~365KB

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented route-level dynamic imports for major dashboard views in `app/page.tsx`.
  - Stabilized workspace sync callback/effect dependency in `app/page.tsx`.
  - Hardened sidebar count polling effect state handling with refs to remove dependency warning and reduce churn.
  - Produced c-stage performance blueprint with budgets, deltas, and next queue.
- Commands run:
  - `npm run lint` — pass (21 warnings, 0 errors).
  - `npm run build -- --webpack` — pass.
  - `.next chunk size inspection commands` — captured before/after top chunk deltas.
- Blockers:
  - None for current c-stage slice.
- Next concrete steps:
  - Address remaining high-impact hook warnings in Action Station and Settings after d-stage hardening pass.
  - Evaluate safe conversion strategy for dashboard/auth `<img>` usage without breaking external logo handling.

## Coordination Notes
**Files modified:** `app/page.tsx`, `components/dashboard/sidebar.tsx`, phase-137 docs.  
**Potential conflicts with:** prior settings-heavy phases (`136`) reviewed; no direct merge conflicts encountered.  
**Integration notes:** changes are additive and maintain existing route/view behavior.
