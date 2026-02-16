# Phase 155f — React #301 Workspace Switch Closure (Instrumentation + Loop Elimination + Verification)

## Focus
Eliminate the remaining production React #301 (“Too many re-renders”) crashes during workspace switching by making the loop diagnosable (console-only) and removing the remaining state/effect cascades that can create infinite rerenders.

## Inputs
- Existing crash capture:
  - `components/dashboard/dashboard-error-boundary.tsx` logs `componentStack` + context.
- Known loop vectors from prior phases:
  - workspace switch effect cascades in `components/dashboard/inbox-view.tsx`
  - unstable identities in virtualization/query keys
  - counts polling + inbox refetch churn
- New read-path changes (Phase 154) that must not reintroduce loops.

## Work
1. Add targeted instrumentation (console-only)
   - Add a debug gate (example: `?debug=1` or env flag) so production logs remain clean by default.
   - Instrument the workspace switch boundary:
     - `components/dashboard/dashboard-shell.tsx`
     - `components/dashboard/inbox-view.tsx`
     - `components/dashboard/sidebar.tsx`
   - On abnormal render counts (e.g., >25 renders within a short time window), log:
     - `activeWorkspace`, `activeView`, `selectedLeadId`
     - current inbox query keys (string form)
     - last state updates that fired (tagged reason strings)

2. Remove remaining loop triggers (rules)
   - No `setState` calls in render paths.
   - All workspace-change resets must use functional bail-outs.
   - Avoid multiple effects that all fire on `activeWorkspace` change unless they are explicitly ordered and guarded.
   - React Query keys must remain primitive/stable.

3. Workspace switch verification matrix
   - With inbox active:
     - switch workspaces 10x rapidly
     - switch while network is slow (throttle)
     - switch when inbox list is empty
     - switch when a conversation is selected
   - Confirm no crash, no stuck spinner, no stacked layout.

4. Guardrails/regression
   - Add at least one automated regression test that can catch obvious render-loop regressions (where feasible).
   - Ensure required repo gates pass.

5. NTTAN gates (required)
   - `npm run test:ai-drafts`
   - `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
   - `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`

## Output
- React #301 workspace-switch crash is no longer reproducible in production builds.
- Console-only instrumentation provides actionable signals if a new loop is introduced.

## Handoff
Close Phase 155 with a short verification packet: what changed, how it was validated, and the rollback levers.

