# Phase 31 — Production Error Remediation (Timeouts, Race Conditions, Connectivity)

## Purpose
Resolve multiple production errors observed in Vercel logs: Prisma unique constraint failures (P2002), EmailBison/OpenAI abort errors, database connectivity issues (P1001), Unipile disconnected accounts, and Vercel runtime timeouts at 800 seconds.

## Context
The production system is experiencing several interrelated failures:

1. **Prisma P2002 on `emailBisonReplyId`**: Webhook race condition where duplicate webhook deliveries hit the unique constraint despite deduplication checks. The current flow does a `findUnique` before `create`, creating a TOCTOU (time-of-check-to-time-of-use) race window.

2. **EmailBison AbortError**: `fetch` calls to EmailBison API are aborting due to timeout (`EMAILBISON_TIMEOUT_MS`) and/or request cancellation. When the dashboard loads lead data, it calls `fetchEmailBisonSentEmails` which can abort under load or navigation.

3. **OpenAI/AI Draft Timeout**: Draft generation via Responses API timing out (30s webhook timeout vs 120s env default). The webhook context has tight time budgets but AI calls can run long, especially with reasoning models.

4. **Undici `DOMException [AbortError]`**: Low-level `fetch` aborts surfacing as `DOMException` in Node/Undici. This is often the same class of issue as (2) but shows up outside EmailBison wrappers and must be classified correctly (timeout vs caller abort).

5. **Unipile 401 "disconnected_account"**: LinkedIn accounts losing provider connection. The cron job logs this but continues, which is correct behavior—but we should surface this to workspace admins.

6. **Prisma P1001 "Can't reach database"**: Supabase connection issues during Insights Cron (notably the context-pack worker/cron). Indicates connection pool exhaustion and/or transient network issues during heavy DB + LLM work.

7. **Vercel 800-second Timeout**: Despite maxDuration=800, some requests are still timing out. This indicates requests are doing too much synchronous work (enrichment, GHL sync, LLM calls, auto-send evaluation, Slack notifications) instead of returning quickly and delegating to background jobs.

Cross-references:
- Phase 20 addressed similar draft generation and webhook timeout issues
- Phase 28 introduced meeting booking reconciliation cron (more DB load)
- Phase 29 added follow-up response analysis (more LLM calls in thread extraction)
- Phase 30 added two-step email drafting (doubled LLM calls)

## Objectives
* [ ] Eliminate P2002 race conditions in email webhook via atomic upsert or catch-and-return
* [ ] Make EmailBison fetch calls resilient with configurable timeouts and graceful degradation
* [ ] Prevent AI draft timeouts from blocking webhook responses (enforce time budgets + move work to background where possible)
* [ ] Add user-facing notification for Unipile disconnected accounts
* [ ] Reduce database connection pressure during Insights Cron (batching, bounded concurrency, retry on P1001)
* [ ] Audit email webhook for long-running synchronous work and move to background jobs
* [ ] Classify AbortError/DOMException aborts to avoid noisy logs + harmful retries

## Constraints
- Vercel Pro plan: max 800s function duration, must stay within limits
- Multi-tenant: all fixes must be workspace-scoped and not affect other workspaces
- No breaking changes to existing webhook contracts (Inboxxia/EmailBison expects 200 OK quickly)
- Background jobs already exist (`BackgroundJob` table + `/api/cron/background-jobs`)
- Prisma connection pool is configured via `DATABASE_URL` (pgbouncer on port 6543)

## Success Criteria
- [ ] No P2002 errors on `emailBisonReplyId` in production logs
- [ ] EmailBison fetch errors are caught and logged without crashing the request
- [ ] AI draft generation failures don't block webhook response (already using background jobs)
- [ ] Unipile disconnected accounts trigger a user-visible notification (schema-consistent: UI banner and/or Slack) with dedupe
- [ ] Insights Cron completes without P1001 errors under normal load; retries/early-exit behavior is explicit when DB is unreachable
- [ ] Email webhook returns 200 OK quickly (target: <5–10s) and never hits the 800s runtime timeout
- [ ] AbortError/DOMException aborts are classified (timeout vs caller cancel) and do not trigger unsafe retries
- [x] `npm run lint` + `npm run build` pass

## Subphase Index
* a — Fix P2002 race condition on emailBisonReplyId (upsert pattern)
* b — Harden EmailBison fetch with timeout/retry and graceful degradation
* c — Audit email webhook for blocking work, move to background jobs
* d — Add Unipile disconnection notification to workspace admins
* e — Reduce Insights Cron database pressure (batching, connection handling)
* f — RED TEAM correction: implement race-safe message inserts using schema-real unique fields (no TOCTOU)
* g — RED TEAM correction: enforce webhook time budgets and move AI/enrichment/autosend to background jobs (email + GHL SMS)
* h — Handle AbortError/DOMException aborts safely (timeouts vs cancellations; retry policy for GET-only)
* i — Fix Insights Cron P1001 at the correct touch point (context-packs route + worker concurrency)
* j — Implement Unipile disconnect notifications in a schema-consistent way (UI + deduped Slack)

## Repo Reality Check (RED TEAM)

- What exists today:
  - `app/api/webhooks/email/route.ts` (Inboxxia/EmailBison email webhook) with `export const maxDuration = 800`
  - `app/api/webhooks/ghl/sms/route.ts` (GHL SMS webhook) with `export const maxDuration = 800`
  - `app/api/cron/background-jobs/route.ts` + `lib/background-jobs/runner.ts` (background job runner)
  - `lib/background-jobs/email-inbound-post-process.ts` (email post-processing worker already present)
  - `lib/emailbison-api.ts` (EmailBison fetch wrapper uses `AbortController`, default 15s, clamp 60s; no retries)
  - `app/api/cron/insights/context-packs/route.ts` + `lib/insights-chat/context-pack-worker.ts` (Insights context-pack cron + worker)
  - `lib/unipile-api.ts` (Unipile client with `checkLinkedInConnection`, `sendLinkedInDM`, `sendLinkedInInMail`)
  - `prisma/schema.prisma`:
    - `Message` unique IDs: `ghlId`, `emailBisonReplyId`, `inboxxiaScheduledEmailId`, `aiDraftId`
    - `FollowUpTask` is lead-scoped and does **not** include `clientId`, `priority`, `title`, `description`, or `metadata`
- What the plan currently assumes (must be verified/corrected during implementation):
  - Some subphases assume `Message.updatedAt` exists to detect upsert vs create (it does not)
  - Some subphases assume workspace notification fields exist on `FollowUpTask` (they do not)
  - Some subphases target the wrong Insights cron route for the observed P1001
- Verified touch points (examples):
  - Email webhook handlers: `handleLeadReplied`, `handleLeadInterested`, `handleUntrackedReply`, `handleEmailSent` (`app/api/webhooks/email/route.ts`)
  - AI draft generation: `generateResponseDraft` (`lib/ai-drafts.ts`)
  - Email sentiment: `analyzeInboundEmailReply` (`lib/sentiment.ts`)
  - Insights worker concurrency knob: `INSIGHTS_CONTEXT_PACK_LEAD_CONCURRENCY` (`lib/insights-chat/context-pack-worker.ts`)

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Webhook does slow enrichment/LLM/autosend work synchronously → hits 800s timeout → upstream retries → duplicates → P2002 + repeated background jobs.
- Treating all `AbortError` as retryable → retry storms when requests are cancelled (navigation) or when upstream is unhealthy.
- “Notify workspace admins” without a schema-consistent store → either no UI signal, or attempted writes to non-existent columns/models.
- Insights worker concurrency too high under load → DB connection pressure + P1001 + cascading failures across crons/webhooks.

### Missing or ambiguous requirements
- Explicit time budgets per context (webhook vs background job vs UI server actions) and which operations are allowed on the critical path.
- Idempotency keys/dedupe policy for:
  - message inserts (unique external IDs)
  - background jobs (dedupe keys derived from message ID + job type)
  - notifications (1/day per workspace per integration)
- Clear classification for aborts: timeout vs caller cancellation vs platform shutdown; and a retry matrix by HTTP method.

### Repo mismatches (fix the plan with appended subphases; do not rewrite completed letters)
- `Message` has no `updatedAt`; plans that depend on `createdAt` vs `updatedAt` to detect creates are invalid.
- `FollowUpTask` cannot store workspace-level “integration disconnected” tasks (no `clientId`, `metadata`, `title`, etc.); plan needs either a schema change or a different channel (UI banner fields on `Client`/`WorkspaceSettings`, plus optional Slack).
- Observed P1001 references `prisma.insightContextPack.findMany()` in Insights cron; the immediate touch point is `app/api/cron/insights/context-packs/route.ts`, not only booked-summaries.

### Performance / timeouts
- `app/api/webhooks/email/route.ts` currently awaits multiple slow calls (EmailBison enrichment, signature AI, Clay, `generateResponseDraft`, auto-send evaluation, Slack DM). These must be moved behind background-job boundaries.
- Increasing `maxDuration` does not fix retries/duplicates; only “return fast + background” does.

### Security / permissions
- Ensure cron auth checks happen before expensive DB work (already mostly true; verify for every cron route touched).
- Ensure webhook auth/tenancy checks happen before deep processing (validate workspace_id / signature / secrets before calling external APIs).

### Testing / validation
- Add a reproducible concurrency test for duplicate webhook deliveries (P2002) and verify 200 OK + dedupe behavior.
- Add timing logs/metrics for webhook critical path and background-job durations; confirm no 800s timeouts over a 24–48h prod window.

## Phase Summary

- Shipped:
  - P2002-safe webhook message inserts + dedupe handling (`lib/prisma.ts`, `app/api/webhooks/*`)
  - Email webhook fast-path + background post-processing + `maxDuration = 60` (`app/api/webhooks/email/route.ts`)
  - EmailBison fetch abort classification + GET-only retries (`lib/emailbison-api.ts`)
  - Insights context-pack cron P1001 retry + circuit breaker (`app/api/cron/insights/context-packs/route.ts`)
  - Unipile disconnect health persisted + Slack alert dedupe (`prisma/schema.prisma`, `lib/workspace-integration-health.ts`)
- Verified:
  - `npm run lint`: pass (warnings only) — `2026-01-17T12:42:51Z`
  - `npm run build`: pass — `2026-01-17T12:43:16Z`
  - `npm run db:push`: pass — `2026-01-17T12:43:55Z` (already in sync)
- Notes:
  - Production verification still required for “no more errors in logs” criteria (P2002/P1001/runtime timeouts).
  - Unipile disconnected state is persisted + Slack-notified; UI banner was added post-review in `app/page.tsx`.
