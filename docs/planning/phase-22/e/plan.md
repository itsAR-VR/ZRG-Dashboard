# Phase 22e — Verification + Rollout Notes (Cross-Workspace Smoke Checks)

## Focus
Confirm the fix resolves the issue for the affected workspace(s) and does not break other workspaces; capture any backfill or operational steps required.

## Inputs
- Fix implementation from Phase 22d.
- Repro checklist from Phase 22a.

## Work
- Smoke test in the UI:
  - Affected workspace(s): confirm positive-intent leads show correct sentiment and attention tabs include all expected leads.
  - Spot-check at least one additional workspace to confirm no regressions.
- Validate data consistency:
  - Counts returned by the server match the list contents for each tab.
  - “Re-analyze Sentiment” updates the expected fields (if applicable).
- Run repo checks:
  - `npm run lint`
  - `npm run build`
- If a data backfill is needed:
  - Document the one-time script/action (scope-limited per workspace) and how to run it safely.

## Output
- Verified repro steps now pass for the affected workspace(s) and at least one other workspace.
- A short rollout note explaining:
  - whether any backfill/manual re-analysis is required,
  - how to confirm the fix in production,
  - and what to monitor (errors, counts anomalies).

## Handoff
If needed, execute a follow-up phase to add deeper test coverage or a backfill tool; otherwise close Phase 22.

