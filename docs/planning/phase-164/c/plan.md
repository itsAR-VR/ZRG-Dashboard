# Phase 164c — Frontend Stabilization (Search Trigger Guardrails + Render Churn)

## Focus
Ensure the UI does not accidentally trigger expensive backend behavior (especially while the user is typing), and avoid effect-driven refetch loops.

## Inputs
- Backend guardrails from Phase 164b.
- Existing inbox search UI in `components/dashboard/conversation-feed.tsx`.

## Work
- Ensure server-side search is only invoked for meaningful queries:
  - always allow clearing search (`""`)
  - suppress server calls for short queries
  - trim whitespace and normalize before sending
- Keep local search state consistent and avoid “derived state in effects” patterns.
- Confirm Playwright has stable selectors for key interactions (search input).

## Output
- Frontend changes aligned with React best practices and backend constraints.

## Handoff
Proceed to Phase 164d to finalize the probe + Playwright canary harness and write a short runbook.

