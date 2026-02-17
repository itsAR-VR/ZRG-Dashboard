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

## Progress This Turn (Terminus Maximus)
- Work done:
  - Parsed `zrg-dashboard-log-export-2026-02-16T23-51-57.json` and confirmed 1,562 unique request IDs timing out at 300s on `/api/inbox/conversations` with full-email `search=` query params.
  - Identified hot-path risk in full-email search OR condition (`currentReplierEmail` exact match in the same branch) and updated the query to use indexed email paths (`email`, `alternateEmails`) for the primary lookup.
  - Added DB statement timeout guardrails for inbox conversation list fetches (`getConversationsCursor` + `getConversationsFromEnd`) to prevent long-running statements from consuming the full Vercel runtime budget.
  - Reused full-email detection logic across both conversation list paths to keep behavior consistent.
- Commands run:
  - `jq -r '.[] | .responseStatusCode' zrg-dashboard-log-export-2026-02-16T23-51-57.json | sort -n | uniq -c` — pass (all exported rows were `504`, endpoint-specific incident packet).
  - `jq -r '.[] | select(.requestId!=null) | .requestId' zrg-dashboard-log-export-2026-02-16T23-51-57.json | sort | uniq | wc -l` — pass (`1562` unique timed-out requests).
  - `npx eslint actions/lead-actions.ts` — pass.
  - `npm run typecheck` — pass.
- Blockers:
  - None for code + static validation in this turn.
- Next concrete steps:
  - Run live canary (`scripts/inbox-canary-probe.ts` + `e2e/inbox-perf.spec.mjs`) against the current deployment and confirm p95 stabilization.
  - If residual p95 spikes remain, open follow-up index work (Phase 165) for `currentReplierEmail` and text-search paths.
