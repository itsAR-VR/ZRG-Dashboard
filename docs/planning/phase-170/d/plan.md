# Phase 170d — Settings Hydration + Accessibility/UX Performance Hardening

## Focus
Improve Settings load speed and stability by reducing initial hydration payload cost and sequencing expensive integrations/booking fetches safely.

## Targets
- Settings initial load p95 `< 2.5s` (measured via authenticated settings canary)
- No repeated heavy knowledge-asset body hydration on non-AI tabs
- Integrations/booking deferred slices load on-demand without blocking initial tab render
- Accessibility checklist passes for keyboard nav, loading feedback, and focus visibility

## Inputs
- `docs/planning/phase-170/c/plan.md`
- `components/dashboard/settings-view.tsx`
- `actions/settings-actions.ts`

## Work
1. Split critical vs non-critical settings data payloads and reduce initial hydration weight.
2. Defer or lazy-load high-cost slices (integrations, booking, heavy knowledge-asset content) with explicit stale guards.
3. Minimize rerender churn from broad state updates during workspace switches.
4. Run accessibility/perceived-performance checks on Settings flows (keyboard, loading states, feedback timing).
5. Ensure admin-only controls preserve authorization boundaries.

## Validation
- `npm run lint`
- `npm run build`
- `npm test`
- `npm run test:e2e -- e2e/settings-perf.spec.mjs`
- Manual accessibility/performance checklist attached to artifacts.

## Output
- Settings hardening patch set + a11y/perf evidence in `docs/planning/phase-170/artifacts/settings-pass.md`

## Handoff
Subphase e executes the full 20-iteration cross-section loop with measured deltas.
