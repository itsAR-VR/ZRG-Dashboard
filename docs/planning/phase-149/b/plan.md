# Phase 149b — High-Risk Loop Guard Hardening (`insights-chat-sheet`, `inbox-view`)

## Focus
Eliminate the most likely render/update thrash paths tied to React #301 in primary dashboard surfaces.

## Inputs
- Phase 149a repro matrix and prioritized loop vectors
- Current implementations in:
  - `components/dashboard/insights-chat-sheet.tsx`
  - `components/dashboard/inbox-view.tsx`

## Work
- Harden `insights-chat-sheet` effect coupling to avoid repeated `loadSession` triggers when `sessions` reference churns without meaningful selection change.
- Harden `inbox-view` manual refetch trigger so refetch only executes on meaningful transitions (not every readiness/visibility flap).
- Ensure all new state setters are idempotent/guarded (no-op on equivalent value).
- Preserve Phase 144 polling and activity behavior while reducing feedback-loop risk.
- Validate touched flows manually in local prod-mode run.

## Output
- `components/dashboard/insights-chat-sheet.tsx`
  - Introduced `selectedSessionExists` boolean memo and rewired effects to depend on it (instead of `sessions` reference), preventing redundant `loadSession()` runs on session list refresh.
- `components/dashboard/inbox-view.tsx`
  - Introduced `conversationsQueryEnabled` and rewired `enabled` + `refetchInterval` checks to use it.
  - Replaced the unconditional “when enabled/visible, refetch” effect with a transition-guarded refetch (only on enabled flip or visibility regain) to avoid refetch-driven render thrash.

## Handoff
Proceed to Phase 149c and clean up remaining state-sync weak spots (sidebar counts, any remaining dashboard sync effects), without widening scope into server/message paths.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented loop-hardening changes in `insights-chat-sheet` and `inbox-view`.
- Commands run:
  - `npx eslint components/dashboard/insights-chat-sheet.tsx components/dashboard/inbox-view.tsx components/dashboard/sidebar.tsx` — pass (warnings only; pre-existing).
- Blockers:
  - None.
- Next concrete steps:
  - Harden sidebar counts behavior when leaving Inbox / clearing workspace.
  - Run full `npm run lint`, `npm run build`, `npm test` gates.
