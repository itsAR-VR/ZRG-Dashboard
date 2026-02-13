# Phase 149a — Reproduction Matrix + Instrumentation Boundaries

## Focus
Create a deterministic reproduction map for React #301 and define exactly which dashboard surfaces/effects are in scope before code edits.

## Inputs
- `docs/planning/phase-149/plan.md`
- Existing error traces referencing chunk `4bd1b696-43ba64781d20dbb7.js`
- Current dashboard effect/state findings from this conversation

## Work
- Build a repro matrix covering:
  - Inbox workspace switch + conversation open/refresh
  - Action Station channel/draft transitions
  - Insights chat session load + workspace switch
- Identify observable loop/churn indicators (rapid repeated fetches, repeated state transitions, repeated effect-trigger paths).
- Capture scope boundaries:
  - In-scope: dashboard client loop/state synchronization files
  - Out-of-scope: external `sw.js`/`NetworkMonitor` runtime not present in repo
- Define minimal instrumentation approach (temporary logs/counters if needed) to confirm loop closure without broad invasive changes.

## Output
- Reproduction matrix (manual, UI):
  - Load dashboard: `/` → confirm no React error in console during initial hydration.
  - Inbox: switch workspaces (sidebar) → open conversation → switch conversations quickly.
  - Insights: open Insights view → open Insights console sheet → switch sessions → create a session.
  - Page visibility: switch tabs away/back (visibility change) while Inbox is active.
- In-scope targets:
  - `components/dashboard/inbox-view.tsx` (polling + manual refetch effect)
  - `components/dashboard/insights-chat-sheet.tsx` (session list ↔ session load coupling)
  - `components/dashboard/sidebar.tsx` (counts polling + view/workspace transitions)
- Out-of-scope:
  - `sw.js` / `NetworkMonitor` timeouts (no in-repo implementation found).

## Handoff
Proceed to Phase 149b and harden the highest-frequency effect/state loops first, then validate with `lint/build/test`.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Ran multi-agent checks (`git status --porcelain`, last 10 phases) and scoped Phase 149 to UI-only per user (no NTTAN).
  - Built the repro matrix and confirmed the primary in-scope loop candidates.
- Commands run:
  - `git status --porcelain` — pass (repo is dirty from concurrent phases; Phase 149 files were clean before edits).
  - `ls -dt docs/planning/phase-* | head -10` — pass.
- Blockers:
  - Browser-level reproduction of React #301 is not available inside this CLI session → requires manual verification in a real browser (local or Vercel).
- Next concrete steps:
  - Implement effect guards in `components/dashboard/inbox-view.tsx` and `components/dashboard/insights-chat-sheet.tsx`.
  - Fix view/workspace transition state drift in `components/dashboard/sidebar.tsx`.
