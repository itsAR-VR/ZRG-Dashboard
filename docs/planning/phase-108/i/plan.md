# Phase 108i — QA + Validation + Rollout Notes

## Focus
Run verification steps, document rollout notes, and confirm safety gates across insights, evals, and overseer changes.

## Inputs
- Implemented outputs from Phase 108a–h.
- Repo guardrails (AGENTS.md).

## Work
1. **Quality gates:**
   - `npm run lint`
   - `npm run build`
   - If Prisma schema changed: `npm run db:push`
2. **Smoke tests:**
   - Generate a message performance run for a known workspace.
   - Verify booked vs not-booked cohorts and attribution windows.
   - Confirm proposals require admin approval and are applied by super-admins only.
3. **Rollout notes:**
   - Feature flags (if any).
   - Cron opt-in behavior.
   - Known limitations.

## Output
- `npm run db:push` succeeded (Prisma schema synced).
- `npm run lint` completed with existing warnings (no errors).
- `npm run build` succeeded with existing CSS optimizer warnings + baseline-browser-mapping notices.
- `npm test` passed (167 tests, 0 failures).
- Manual smoke tests still required in a live workspace (report run + proposal approval/apply + rollback).
- Rollout notes: weekly cron opt-in is per workspace; proposals require admin approval; super-admin allowlist controls apply.

## Handoff
- Run manual smoke in a real workspace:
  - Generate a Message Performance report for a known booked lead; verify attribution and outcomes.
  - Approve a proposal as admin; apply as super-admin; confirm prompt/asset revision history/rollback.
- If anything fails in live data, capture repro details for follow-up.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Fixed Prisma relation backref and several TypeScript type errors in message performance + knowledge asset flows.
  - Ran db push, lint, build, and test suites.
- Commands run:
  - `npm run db:push` — pass (schema synced)
  - `npm run lint` — pass with warnings (hooks/img warnings pre-existing)
  - `npm run build` — pass with warnings (CSS optimizer + baseline-browser-mapping)
  - `npm test` — pass (167 tests)
- Blockers:
  - Manual smoke tests require a live workspace/session → pending.
- Next concrete steps:
  - Perform live smoke tests and confirm proposal apply/rollback behavior.
