# Phase 42 — Verification Runbook (Jan 19, 2026 log signatures)

## Goal
Verify the specific production errors observed on **January 19, 2026** no longer repeat:

- `refresh_token_not_found`
- `Failed to get inbox counts: Error: Unauthorized`
- Prisma `P2002` on `BackgroundJob.dedupeKey`
- Lead scoring `UND_ERR_BODY_TIMEOUT` / `TypeError: terminated`
- EmailBison replies fetch `401` (“URL/key mismatch” hint)
- Vercel `Task timed out after 300 seconds`

## Pre-Deploy (Local)
- Run `npm run typecheck`
- Run `npm run lint`
- (Optional) Run `npm run build`

## Verification Steps

### 1) Signed-out navigation should not spam `refresh_token_not_found`
1. Ensure you are signed out (clear cookies / open an incognito window).
2. Visit the dashboard root route.
3. Expected:
   - You are redirected to `/auth/login` (for protected routes).
   - Server logs do **not** emit repeated `AuthApiError ... refresh_token_not_found`.

### 2) Inbox counts should not log noisy auth/authorization errors
1. With no valid session (or with a stale/unauthorized workspace selection), load the dashboard.
2. Expected:
   - Sidebar loads without server `[error] Failed to get inbox counts: Error: Unauthorized` log spam.
   - Counts safely render as `0` (empty-state) instead of crashing SSR.

### 3) EmailBison 401 becomes actionable (and non-noisy)
1. Configure an invalid EmailBison API key for a workspace (or set `EMAILBISON_BASE_URL` incorrectly).
2. Trigger an EmailBison-backed operation (examples):
   - Settings → Integrations → Sync Email
   - Lead-level Email sync (conversation history)
   - Reactivations resolver (if used)
3. Expected:
   - UI shows an actionable message (key + base URL guidance), not “Unknown error”.
   - Server logs use `warn`-level diagnostics with `{ status, endpoint, host }` and do **not** dump PII payloads.

### 4) Lead scoring timeouts retry instead of “succeeding” silently
1. Trigger a lead scoring background job (send/ingest an inbound message that enqueues scoring).
2. If OpenAI/network is slow, observe behavior.
3. Expected:
   - `UND_ERR_BODY_TIMEOUT`/`terminated` errors are treated as retryable.
   - The BackgroundJob runner reschedules the job with backoff (job does not incorrectly report “no inbound messages” if scoring failed).

### 5) Background job enqueue is idempotent (no `P2002`)
1. Trigger two concurrent enqueue attempts for the same lead+message scoring job (e.g., double webhook delivery / duplicate processing).
2. Expected:
   - No `PrismaClientKnownRequestError` `P2002` is logged.
   - One job is created; duplicates are treated as “already enqueued”.

### 6) Vercel timeouts
1. Trigger historically long-running flows (bulk sync, cron processors).
2. Expected:
   - Cron routes that can run long have `maxDuration = 800` configured.
   - No repeat of `Task timed out after 300 seconds` for the affected endpoints under normal workloads.

## Post-Deploy Watch (Next 24 Hours)
In Vercel logs, confirm these signatures are absent or significantly reduced:
- `refresh_token_not_found`
- `Failed to get inbox counts`
- `P2002` (dedupeKey)
- `UND_ERR_BODY_TIMEOUT`
- EmailBison `Replies fetch failed (401)` (should be mapped + warn-level, not noisy payload dumps)
- `Task timed out after 300 seconds`

