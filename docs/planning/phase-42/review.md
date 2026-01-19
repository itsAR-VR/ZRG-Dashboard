# Phase 42 — Review

## Summary
- Phase 42 changes are present in the current working tree, but not yet committed (mixed with other active phase changes).
- `npm run lint` passes (0 errors, warnings only) and `npm run build` passes on the combined state (see Verification).
- Success criteria that require production log confirmation remain **partial** (see `docs/planning/phase-42/e/runbook.md`).
- Review follow-ups are implemented: per-workspace EmailBison base host allowlist + selection UI, and enqueue-only conversation sync via BackgroundJobs to eliminate `POST /` timeouts.

## What Shipped (Observed in Working Tree)
- Auth/session hardening to reduce noisy Supabase refresh/session errors:
  - `lib/supabase/middleware.ts` (skip middleware network calls when no auth cookie; treat invalid/missing sessions as signed-out)
  - `lib/workspace-access.ts` + `lib/supabase/error-utils.ts` (normalize Supabase auth errors to “Not authenticated”)
- Inbox counts resilience for signed-out/unauthorized states:
  - `actions/lead-actions.ts` (`getInboxCounts` returns safe zero counts for auth/authorization errors without error log spam)
- EmailBison error mapping + safer diagnostics:
  - `lib/emailbison-api.ts` (actionable auth failures, endpoint + host context, bounded retries/timeouts for GETs, per-request base host support)
- EmailBison per-workspace base host allowlist + selection UI:
  - `prisma/schema.prisma` (`EmailBisonBaseHost`, `Client.emailBisonBaseHostId`)
  - `actions/emailbison-base-host-actions.ts` (CRUD + default seeding)
  - `components/dashboard/settings/integrations-manager.tsx` (host management + per-workspace selector)
- Lead scoring hardening:
  - `lib/lead-scoring.ts` (retryable timeout classification incl. `UND_ERR_BODY_TIMEOUT`, bounded retries/timeouts, idempotent enqueue via unique constraint handling)
  - `lib/background-jobs/lead-scoring-post-process.ts` (throws only on retryable failures so BackgroundJobs backoff/retry)
- Vercel runtime ceilings extended for long-running cron routes:
  - `app/api/cron/followups/route.ts` (`export const maxDuration = 800`)
  - `app/api/cron/reactivations/route.ts` (`export const maxDuration = 800`)
- Conversation sync moved off the `POST /` request path:
  - `prisma/schema.prisma` (`BackgroundJobType.CONVERSATION_SYNC`)
  - `lib/background-jobs/conversation-sync.ts` + `lib/background-jobs/runner.ts`
  - `actions/message-actions.ts:enqueueConversationSync()` + `components/dashboard/inbox-view.tsx` (enqueue-only; no inline sync)
- Verification runbook aligned to Jan 19, 2026 log signatures:
  - `docs/planning/phase-42/e/runbook.md`

## Evidence (git)
- `git status --porcelain` shows uncommitted changes across multiple active phases (notably Phase 40 + Phase 41) and Phase 42.
- Key Phase 42-related paths present in the working tree:
  - `lib/supabase/middleware.ts`, `lib/supabase/error-utils.ts`, `lib/workspace-access.ts`
  - `actions/lead-actions.ts`
  - `lib/emailbison-api.ts`
  - `lib/lead-scoring.ts`, `lib/background-jobs/lead-scoring-post-process.ts`
  - `app/api/cron/followups/route.ts`, `app/api/cron/reactivations/route.ts`
  - `docs/planning/phase-42/*`

## Verification

### Commands
- `npm run typecheck` — pass (2026-01-19T18:27:43Z)
- `npm run lint` — pass (0 errors, warnings only) (2026-01-19T18:27:43Z)
- `npm run build` — pass (2026-01-19T18:27:43Z)
- `npm run db:push` — pass (2026-01-19T18:27:43Z)

### Notes
- `npm run build` ran `prisma generate` and `next build` successfully.
- Next.js emitted a workspace-root warning about multiple lockfiles; build still succeeded.

## Success Criteria → Evidence

1. “Inbox counts” treats unauth/unauthorized as a normal empty-state (no error logs; safe zero counts).
   - Evidence: `actions/lead-actions.ts` (`getInboxCounts` returns empty for `"Not authenticated"` / `"Unauthorized"` without logging).
   - Status: met (code-level; build/lint pass)

2. EmailBison `401` errors are actionable and include safe diagnostic context (status + endpoint + host).
  - Evidence: `lib/emailbison-api.ts` (`formatEmailBisonAuthFailure`, `formatEmailBisonHttpError` include host and endpoint; no key logging).
  - Status: met (code-level; per-workspace host selection implemented)

3. Background job enqueue is idempotent for lead scoring (duplicate enqueue attempts don’t throw `P2002`).
   - Evidence: `lib/lead-scoring.ts` (`enqueueLeadScoringJob` handles unique constraint collisions as “already enqueued”).
   - Status: met (code-level)

4. Lead scoring timeouts are retryable and reschedule via BackgroundJobs without crashing the runner.
   - Evidence:
     - `lib/lead-scoring.ts` retryable classification includes `UND_ERR_BODY_TIMEOUT` / `UND_ERR_HEADERS_TIMEOUT` codes
     - `lib/background-jobs/lead-scoring-post-process.ts` throws only when `result.retryable`
   - Status: met (code-level; production verification pending)

5. No repeated `refresh_token_not_found` errors in production logs during normal signed-out navigation.
   - Evidence: mitigation in `lib/supabase/middleware.ts` + `lib/workspace-access.ts` to avoid noisy auth refresh attempts and normalize auth errors.
   - Status: partial (requires post-deploy verification)

6. No `Task timed out after 300 seconds` for the affected endpoints.
   - Evidence:
     - cron routes updated to `maxDuration = 800` (`app/api/cron/followups/route.ts`, `app/api/cron/reactivations/route.ts`)
     - conversation sync now enqueues a per-lead BackgroundJob (`BackgroundJobType.CONVERSATION_SYNC`) via `actions/message-actions.ts` and `components/dashboard/inbox-view.tsx` (no inline sync on `POST /`)
   - Status: partial (requires post-deploy verification; see runbook)

## Plan Adherence
- Planned vs implemented deltas:
  - EmailBison base host: per-workspace allowlist + selection UI implemented; requests now use the selected base host (fallback to env/default if unset).
  - `POST /` timeout: conversation sync is now enqueue-only via BackgroundJobs; remaining work is production log confirmation post-deploy.

## Risks / Rollback
- Middleware auth-cookie fast-path could misclassify auth state if cookie naming diverges from the expected Supabase storage key; mitigation is in `docs/planning/phase-42/e/runbook.md` (signed-out navigation + log verification).
- EmailBison host configuration is now per-workspace (allowlisted). A missing/incorrect base host selection can break EmailBison sync for that workspace; remediation is via Settings → Integrations.

## Follow-ups
- Post-deploy verification in Vercel logs using `docs/planning/phase-42/e/runbook.md` (confirm Jan 19, 2026 signatures no longer repeat).
