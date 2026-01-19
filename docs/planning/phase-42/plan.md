# Phase 42 — Production Error Triage + Hardening

## Purpose
Eliminate recurring production log errors across auth, inbox counts, EmailBison sync, background jobs, and lead scoring by hardening auth/session handling, adding bounded retries/timeouts, and making job enqueue/idempotency reliable.

## Context
Vercel logs from **January 19, 2026** show several independent failures:

- **Supabase auth refresh failures**
  - `AuthApiError: Invalid Refresh Token: Refresh Token Not Found` (`refresh_token_not_found`)
  - Likely caused by server-side “refresh session” logic running when the refresh token cookie is missing/cleared (signed-out, expired cookies, cross-domain cookie mismatch, etc).

- **Inbox counts unauthorized**
  - `Failed to get inbox counts: Error: Unauthorized`
  - Indicates server-side counts are being fetched without a valid session (or are using the wrong auth client context).

- **Vercel runtime timeouts**
  - `Task timed out after 300 seconds`
  - Suggests at least one request path is still doing long-running work synchronously (or a job runner endpoint is not chunking/short-circuiting).

- **Lead scoring timeouts + flaky AI outputs**
  - `Body Timeout Error` (`UND_ERR_BODY_TIMEOUT`) while scoring a lead
  - “incomplete JSON … retrying” indicates the parsing/retry strategy still hits truncation edge cases.

- **Background job enqueue dedupe collisions**
  - Prisma `P2002` unique constraint failure on `BackgroundJob.dedupeKey`
  - Indicates multiple code paths can enqueue the same job concurrently and the enqueue path is not idempotent.

- **EmailBison API authentication failures**
  - Replies fetch fails `401` with: “The request is not authenticated. Ensure you are using the correct URL, and a key that exists for the URL.”
  - Needs clearer diagnostics + environment validation + safer error mapping so failures become actionable.

This phase scopes a targeted hardening pass to stop noisy errors, prevent avoidable retries/timeouts, and ensure “expected unauth” is treated as a normal signed-out state rather than an error.

## Repo Reality Check (RED TEAM)

- What exists today:
  - Supabase auth is checked via `supabase.auth.getUser()` in:
    - `middleware.ts` → `lib/supabase/middleware.ts:updateSession()`
    - `lib/workspace-access.ts:requireAuthUser()` (used by many Server Actions)
    - `actions/auth-actions.ts:getCurrentUser()`
  - Inbox counts log line is emitted by `actions/lead-actions.ts:getInboxCounts()` (`console.error("Failed to get inbox counts:", error)`).
  - Background job enqueue helpers exist in `lib/background-jobs/enqueue.ts` and already handle `P2002` by treating “already enqueued” as success.
  - Email webhook job enqueue is idempotent via `app/api/webhooks/email/route.ts:enqueueEmailInboundPostProcessJob()` using `prisma.backgroundJob.upsert({ where: { dedupeKey } ... })`.
  - Lead scoring enqueue currently has a race window in `lib/lead-scoring.ts:enqueueLeadScoringJob()` (non-atomic “find then create” against a unique `BackgroundJob.dedupeKey`).
  - Follow-ups cron runs a multi-step pipeline in `app/api/cron/followups/route.ts` and does not currently export a `maxDuration`.
  - EmailBison client lives in `lib/emailbison-api.ts` and includes:
    - `emailBisonFetch()` with explicit timeouts + bounded retries for GETs (`EMAILBISON_TIMEOUT_MS`, `EMAILBISON_MAX_RETRIES`)
    - partial 401 mapping (campaign fetch), but other endpoints still return generic errors
- What the plan assumes:
  - The `refresh_token_not_found` log signature originates from server-side `getUser()` calls when the refresh cookie is missing/expired.
  - The 300s timeout is from a Server Action invocation on `POST /` (request ID `hp74t-1768813460047-21e481a8c16a`), not from `/api/cron/followups`.
  - The `P2002` enqueue error is triggered by at least one code path not using the idempotent helper (currently: lead scoring enqueue).
- Verified touch points:
  - `middleware.ts`, `lib/supabase/middleware.ts`, `lib/supabase/server.ts`
  - `lib/workspace-access.ts`, `actions/lead-actions.ts`, `actions/auth-actions.ts`
  - `prisma/schema.prisma` (`model BackgroundJob { dedupeKey @unique }`)
  - `lib/background-jobs/enqueue.ts`, `lib/background-jobs/runner.ts`, `lib/lead-scoring.ts`
  - `app/api/cron/followups/route.ts`
  - `lib/emailbison-api.ts`

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 41 | Active (uncommitted changes in working tree) | Domain: EmailBison auth + sync; File: `lib/emailbison-api.ts` | Align error mapping + auth handling changes with Phase 41; avoid conflicting edits to EmailBison client. |
| Phase 40 | Active (uncommitted changes in working tree) | None | Avoid touching `scripts/crawl4ai/*` deployment work while fixing production log errors. |
| Phase 35 | Reference | Domain: Vercel timeouts + background jobs | Keep fixes consistent with the webhook→background-job architecture and dedupe strategy. |
| Phase 38 | Reference | Domain: AI JSON parsing robustness | Reuse truncation-aware parsing and bounded retries to reduce “incomplete JSON” errors. |
| Phase 33 | Reference | Domain: Lead scoring engine | Keep scoring pipeline semantics consistent (skip when no inbound; bounded work; idempotent jobs). |

## Pre-Flight Conflict Check

- [ ] Run `git status --porcelain` and confirm only expected in-progress files are modified (Phase 41 EmailBison + Phase 40 Crawl4AI).
- [ ] Re-read current state of `lib/emailbison-api.ts` before editing (Phase 41 overlap).
- [ ] If `prisma/schema.prisma` needs changes, coordinate across active phases before applying `npm run db:push`.

## Decisions Locked (Stakeholder Clarifications)

- (Jan 19, 2026) The `Task timed out after 300 seconds` event is on `POST /` (Server Action) — not `/api/cron/followups`. Vercel request ID: `hp74t-1768813460047-21e481a8c16a`.
  - Observed log context includes SMS + Email conversation sync work (e.g., `[Sync] Fetching SMS history...`, `[EmailSync] Fetching conversation history...`), plus upstream calls to Supabase, GHL (`leadconnectorhq.com`), EmailBison (`send.meetinboxxia.com`), and OpenAI.
- EmailBison base URL must be configurable (not hard-coded) to support multiple organizations/white-label email licenses.
- Add an Integrations setting to manage **allowed EmailBison base hosts** (so new org domains can be added without redeploying) and allow each workspace to select the appropriate base host.
- Seed initial allowed EmailBison base hosts:
  - `send.meetinboxxia.com` (existing default)
  - `send.foundersclubsend.com` (new org)
- Middleware should rely on server-side auth checks (prefer “fail open” for transient Supabase failures; enforce auth in server actions/routes).
- Long-running sync work must be enqueued to BackgroundJobs (no 5-minute request path work). Manual “Sync” is allowed/desired for operators.
- Extend timeouts to 800s where applicable (Vercel runtime/maxDuration). (Jan 19, 2026)

## Objectives
* [x] Identify the concrete code paths generating each log error
* [x] Make auth/session behavior deterministic (no refresh attempts without a refresh token)
* [x] Make inbox count fetches safe under unauth / expired sessions
* [x] Ensure job enqueue paths are idempotent (no `P2002` dedupe collisions)
* [x] Bound network/AI operations with explicit timeouts and retries
* [ ] Eliminate Vercel 300s request timeouts for the affected endpoints (requires post-deploy confirmation; conversation sync is now enqueued to BackgroundJobs)

## Constraints
- Never log secrets (Supabase tokens, EmailBison keys, cron/admin secrets) or sensitive user data.
- Maintain existing response shapes for actions/routes (don’t break callers). If an endpoint already returns `{ success, data?, error? }`, keep it structured.
- Any webhook/cron path must be idempotent and safe to retry.
- Keep Vercel request paths within runtime limits (avoid synchronous long-running work).

## Non-Goals
- Rewriting the auth system (this is targeted hardening + better defaults/guards, not an auth redesign).
- Large refactors of follow-up logic (only changes needed to prevent timeouts + improve bounded execution).
- Changing provider domains/credentials storage without confirmation (especially EmailBison base URL behavior).

## Success Criteria
- [x] “Inbox counts” treats unauth/unauthorized as a normal empty-state (no error logs for expected signed-out states; safe zero counts returned).
- [x] EmailBison `401` errors are actionable (clear message about URL/key mismatch / base URL guidance) and include safe diagnostic context (status + endpoint + host).
- [x] Background job enqueue is idempotent for lead scoring: duplicate enqueue attempts do not throw `P2002` and are treated as “already enqueued”.
- [x] Lead scoring network/AI calls treat undici/OpenAI timeouts as retryable and reschedule via BackgroundJob retries without crashing the cron runner.
- [ ] No repeated `refresh_token_not_found` errors in production logs during normal signed-out navigation (requires post-deploy verification).
- [ ] No `Task timed out after 300 seconds` for the endpoints involved in these flows (requires post-deploy verification; conversation sync is now enqueued to BackgroundJobs).

## Subphase Index
* a — Supabase session + inbox counts auth hardening
* b — EmailBison auth + 401 diagnostics and mapping
* c — Background job enqueue idempotency + Vercel timeout reduction
* d — Lead scoring timeouts + JSON robustness
* e — Verification runbook + regression coverage
* f — Concrete repo mapping + patch checklist (RED TEAM)
* g — Stakeholder clarifications addendum (timeout route + EmailBison base URL)
* h — EmailBison per-workspace base host allowlist + selection UI
* i — Off-request-path conversation sync (BackgroundJobs)

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Auth noise spirals into real UX bugs (redirect loops / unexpected logouts) → treat `refresh_token_not_found` as signed-out, avoid hard redirects on transient middleware failures, and keep server actions resilient to missing cookies.
- Follow-ups cron exceeds Vercel runtime (300s) and silently fails mid-run → add explicit time budget checks and chunk/limit each step; ensure the endpoint returns partial progress rather than timing out.
- Background job enqueue races still exist outside the shared helper (lead scoring enqueue) → replace “find then create” patterns with `upsert` or the shared `enqueueBackgroundJob()` path and treat duplicates as success.
- EmailBison auth failures cause repeated retries/timeouts across multiple features (sync, history, enrichment) → centralize 401 handling and stop retrying on auth failures; surface actionable remediation.

### Missing or ambiguous requirements
- Which Server Action is producing the 5-minute `POST /` timeout (and why it’s running SMS/Email sync work on the request path) → must identify the exact action/function so we can timebox/offload it.
- Desired UX for signed-out state on protected pages (redirect vs show login CTA) when middleware can’t validate user due to Supabase error → define expected behavior so “fail open” doesn’t become a security hole.
- EmailBison base URL validation: allowlist vs free-text (security posture + SSRF risk) → must lock down how we accept/store the base URL.

### Repo mismatches (fix the plan)
- “Inbox counts unauthorized” maps to `actions/lead-actions.ts:getInboxCounts()` calling `resolveClientScope()` → fix should focus on distinguishing expected auth errors vs true unexpected exceptions and downgrading logs accordingly.
- “Job enqueue not idempotent” is not globally true: `lib/background-jobs/enqueue.ts` already catches unique constraint errors; the known race is `lib/lead-scoring.ts:enqueueLeadScoringJob()`.

### Performance / timeouts
- `app/api/cron/followups/route.ts` runs multiple steps sequentially; each must have a limit + early-exit when near budget.
- EmailBison calls should consistently use the timeout-aware fetch wrapper; avoid accidental raw `fetch()` usage without timeouts in the client.
- RED TEAM: extending maxDuration/timeouts to 800s is not a substitute for moving long work off request paths; keep BackgroundJobs + explicit per-call timeouts to avoid “hang forever” failure modes.

### Security / permissions
- Ensure all cron/admin endpoints validate secrets before doing heavy work and avoid logging secrets; prefer safe, structured diagnostics (status + endpoint + workspace/client IDs).
- Confirm middleware “fail open” behavior does not allow access to protected routes; protected routes should remain guarded by server-side auth checks where needed.

### Testing / validation
- Add regression coverage specifically for:
  - `getInboxCounts()` signed-out behavior (no error logs, returns zeros)
  - Lead scoring enqueue idempotency under concurrency (no `P2002`)
  - EmailBison 401 mapping is actionable and includes safe endpoint context
- Add a Vercel log verification checklist (post-deploy) keyed to the exact Jan 19, 2026 error signatures.

### Multi-agent coordination
- Phase 41 currently edits `lib/emailbison-api.ts`; resolve/merge that work before applying Phase 42 changes to avoid conflicting error mapping strategies.
- Phase 40 is deploying `scripts/crawl4ai/*`; do not mix deployment changes with production hardening in the same PR.

## Open Questions (Need Human Input)

- [x] Which Vercel function path logged `Task timed out after 300 seconds`? (resolved Jan 19, 2026)
  - Answer: `POST /` (Server Action), Vercel request ID `hp74t-1768813460047-21e481a8c16a`.
- [x] Should EmailBison base URL be configurable instead of hard-coded to `send.meetinboxxia.com`? (resolved Jan 19, 2026)
  - Answer: Yes — required for multi-org / white-label email licensing.
- [x] For Supabase auth errors in middleware: “fail open” vs “fail closed”? (resolved Jan 19, 2026)
  - Answer: Prefer “fail open” in middleware; rely on server-side auth checks in actions/routes.
- [x] EmailBison base URL config: per-workspace DB field vs env-level mapping, and what host allowlist should we enforce? (resolved Jan 19, 2026)
  - Answer: Add an Integrations setting to manage allowed base hosts (no redeploy), and allow workspaces to select from that list.
- [x] For the Server Action currently doing SMS/Email sync: should it be (a) user-triggered with progress UI, or (b) automatic but offloaded to BackgroundJobs with eventual consistency? (resolved Jan 19, 2026)
  - Answer: Enqueue BackgroundJobs (return fast) AND keep manual sync available for operators.
- [x] What are the initial additional EmailBison base host(s) we should seed/allow (beyond `send.meetinboxxia.com`)? (resolved Jan 19, 2026)
  - Answer: `send.foundersclubsend.com`.
- [x] “All timeouts should be extended to 800 seconds”: does this mean Vercel `maxDuration` only, or also internal HTTP/OpenAI timeouts? (resolved Jan 19, 2026)
  - Answer: Vercel/runtime timeouts only (`maxDuration` / route segment config). Keep internal fetch/OpenAI timeouts bounded and rely on BackgroundJobs + retries.

## Assumptions (Agent)

- Assumption: `refresh_token_not_found` is triggered by `supabase.auth.getUser()` calls when refresh cookies are missing/expired (confidence ~90%).
  - Mitigation question/check: confirm by correlating the log timestamps with middleware and server-action invocations (and verifying cookie presence in a safe way).

## Phase Summary

- Shipped auth/session hardening to reduce noisy Supabase refresh failures: `lib/supabase/middleware.ts`, `lib/workspace-access.ts`, `actions/auth-actions.ts`, `lib/supabase/error-utils.ts`.
- Made inbox counts resilient to signed-out / stale workspace states (safe zero counts; no error log spam): `actions/lead-actions.ts`.
- Improved EmailBison error mapping + safe diagnostics (actionable 401/403 errors; no PII-heavy logs): `lib/emailbison-api.ts`.
- Added per-workspace EmailBison base host allowlist + selection UI: `prisma/schema.prisma`, `actions/emailbison-base-host-actions.ts`, `components/dashboard/settings/integrations-manager.tsx`.
- Eliminated lead scoring enqueue race (`P2002` on `dedupeKey`) and enabled BackgroundJob retries for retryable scoring failures: `lib/lead-scoring.ts`, `lib/background-jobs/lead-scoring-post-process.ts`.
- Reduced bulk sync timeout risk and extended cron ceilings: `actions/message-actions.ts`, `app/api/cron/followups/route.ts`, `app/api/cron/reactivations/route.ts`.
- Moved conversation sync off the `POST /` request path by enqueueing per-lead BackgroundJobs: `lib/background-jobs/conversation-sync.ts`, `actions/message-actions.ts`, `components/dashboard/inbox-view.tsx`.
- Added verification runbook + validated build/lint/typecheck: `docs/planning/phase-42/e/runbook.md`.

**Verified (combined working tree state)**
- `npm run typecheck`: pass (2026-01-19T18:27:43Z)
- `npm run lint`: pass (0 errors, warnings only) (2026-01-19T18:27:43Z)
- `npm run build`: pass (2026-01-19T18:27:43Z)
- `npm run db:push`: pass (2026-01-19T18:27:43Z)
- Review artifact: `docs/planning/phase-42/review.md`

**Remaining / Requires Follow-up**
- Production verification: confirm Jan 19, 2026 error signatures no longer repeat after deploy (see runbook).
