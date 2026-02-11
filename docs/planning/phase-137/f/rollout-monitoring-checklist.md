# Phase 137f — Rollout and Monitoring Checklist

## Pre-Release Gate
- `npm run lint` passes with no errors.
- `npm run build -- --webpack` passes.
- Authenticated flow checklist completed with screenshots and notes:
  - `docs/planning/phase-137/f/authenticated-flow-checklist.md`
- No unresolved critical/high regressions in Settings, Action Station, or CRM drawer.

## Staged Rollout
1. Internal validation window:
   - Validate high-traffic workspaces first.
   - Confirm Settings tab-load behavior and LinkedIn status recovery flow.
2. Controlled rollout:
   - Release with monitoring focus on message send failures and booking flow behavior.
3. Full rollout:
   - Proceed only if no rollback criteria are triggered within observation window.

## Rollback Criteria
- Spike in send-failure rate for any channel vs recent baseline.
- Reappearance of stale workspace data in Settings after tab/workspace churn.
- Booking flow regressions (slot leakage between leads, provider mismatch errors).
- Critical accessibility regressions on hardened surfaces (missing loading/state affordances).

## Monitoring Signals
- Message send outcomes by channel (SMS/Email/LinkedIn).
- Booking success/failure trend and mismatch/error logs.
- Settings load and interaction latency on `General`, `Integrations`, and `Booking` tabs.
- User-reported UX/a11y defects from support channels.

## Post-Release Verification
- Re-run a small subset of checklist scenarios A2, B2, C3 in production.
- Confirm no new lint/build regressions in next CI cycle.
- Record final release notes in phase summary once validated.

