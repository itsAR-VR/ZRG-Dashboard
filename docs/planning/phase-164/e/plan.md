# Phase 164e — Validation + Commit/Push + Live Verification

## Focus
Validate, commit, push, and verify in live environments that performance variance is materially reduced.

## Inputs
- Phase 164a–d outputs.

## Work
- Validation gates (scoped commit only):
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
  - `npm test`
  - `npm run test:e2e`
- Commit/push:
  - Stage only Phase 164 scoped files.
  - Commit message should reference perf variance + canary.
  - Push branch for review/merge.
- Live verification:
  - Run Playwright canary against prod/preview URL.
  - Run `scripts/inbox-canary-probe.ts` with a session cookie and capture output JSON.
  - If budgets fail, capture request IDs and correlate with server logs for root cause (query/index/cold start).
- Rollback:
  - Confirm safe rollback via feature flags (read API flags remain unchanged).
  - If issues arise, revert commit or disable affected features without breaking auth.

## Output
- A pushed commit with evidence (probe output + Playwright pass) that the variance fix is real.

## Handoff
If residual variance remains, open Phase 165 for DB-level search indexing (`pg_trgm`) and/or deeper caching/materialization work.

