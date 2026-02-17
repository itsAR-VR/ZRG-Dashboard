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
  - Implemented a controlled second-pass fallback for full-email searches: when primary indexed lookup returns zero rows, retry once with `currentReplierEmail` included under a shorter statement timeout (`INBOX_FULL_EMAIL_FALLBACK_TIMEOUT_MS = 5000`) to restore expected matching without reopening the original timeout risk.
  - Hardened schema-lag behavior: the second-pass fallback in cursor mode now disables schema-safe broad-query fallback, so it cannot return unrelated conversations when `currentReplierEmail` is unavailable in lagging DB schemas.
- Commands run:
  - `jq -r '.[] | .responseStatusCode' zrg-dashboard-log-export-2026-02-16T23-51-57.json | sort -n | uniq -c` — pass (all exported rows were `504`, endpoint-specific incident packet).
  - `jq -r '.[] | select(.requestId!=null) | .requestId' zrg-dashboard-log-export-2026-02-16T23-51-57.json | sort | uniq | wc -l` — pass (`1562` unique timed-out requests).
  - `npx eslint actions/lead-actions.ts` — pass.
  - `npm run typecheck` — fails in unrelated pre-existing Phase 162 AI files (`lib/ai-drafts.ts` nullability errors); no remaining `actions/lead-actions.ts` type errors after this turn’s changes.
  - `node --import tsx scripts/inbox-canary-probe.ts --base-url https://zrg-dashboard.vercel.app --samples 2` — blocked in this execution environment (`fetch failed`; outbound network restricted here).
- Blockers:
  - Full-repo typecheck is currently blocked by unrelated pre-existing errors in `lib/ai-drafts.ts` (outside Phase 164 scope).
  - Live canary execution from this sandbox is blocked by outbound network restrictions; must be run from your live-capable environment or CI.
- Next concrete steps:
  - Run live canary (`scripts/inbox-canary-probe.ts` + `e2e/inbox-perf.spec.mjs`) against the current deployment and confirm p95 stabilization.
  - If residual p95 spikes remain, open follow-up index work (Phase 165) for `currentReplierEmail` and text-search paths.

## Progress This Turn (Terminus Maximus - Closeout Validation 2026-02-17)
- Work done:
  - Re-ran full local quality gates on the current `main` state.
  - Verified in code that perf safeguards are present in the intended paths:
    - query guardrails and two-pass full-email fallback in `actions/lead-actions.ts`
    - request timing/trace headers in `app/api/inbox/conversations/route.ts` and `app/api/inbox/counts/route.ts`
    - middleware fast-paths that avoid unnecessary auth refresh calls for API/Server Action requests in `lib/supabase/middleware.ts`
  - Applied user directive to skip Playwright execution for this closeout pass.
- Commands run:
  - `npm run lint` — pass (warnings only, no errors).
  - `npm run typecheck` — pass.
  - `npm run build` — pass.
  - `npm test` — pass (`401/401`, `0` failures).
- Blockers:
  - None for local validation and code-level closure checks.
  - Live runtime p95 measurement via Playwright/probe remains an operational verification task if you want fresh production evidence.
- Next concrete steps:
  - Optional operational follow-up: run `scripts/inbox-canary-probe.ts` with authenticated session context against prod/preview to capture updated p95 evidence.
