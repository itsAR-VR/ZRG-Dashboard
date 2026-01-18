# Phase 35 — Webhook-to-Background-Jobs Architecture Refactor

## Purpose

Refactor all webhook handlers to use async background job processing instead of synchronous AI/enrichment operations, eliminating Vercel timeout issues and enabling reliable multi-step processing with independent timeout budgets per task.

## Context

**The Problem:**

Vercel serverless functions have a hard timeout limit (800s on Pro, 60s on Hobby). Currently, most webhook handlers (GHL SMS, LinkedIn, SmartLead, Instantly) perform expensive operations synchronously:

1. Receive webhook → parse payload → create/update lead
2. **Synchronously** run AI sentiment classification (5-15s)
3. **Synchronously** generate AI draft (10-30s with two-step pipeline from Phase 30)
4. **Synchronously** evaluate auto-reply gates (5-10s)
5. **Synchronously** trigger enrichment (Clay API, variable latency)
6. **Synchronously** process auto-booking logic (5-10s)
7. Return webhook response

This creates multiple failure modes:
- **Total time can exceed Vercel timeout** → webhook fails → external platform retries → duplicate processing
- **One slow operation blocks all others** → sentiment fails → no draft generated
- **No retry isolation** → if draft generation fails, entire webhook retries (re-running sentiment unnecessarily)
- **No task prioritization** → urgent tasks (sentiment) wait behind slow tasks (enrichment)

**The Solution (Email Pattern from Phase 31):**

Email webhooks already use background jobs:

```
Email webhook:
  1. Receive webhook → validate → create Message record → enqueue EMAIL_INBOUND_POST_PROCESS job → return 200 OK (< 2s)

Background job (runs in separate cron; `maxDuration = 800`, runner time budget is configurable):
  2. EMAIL_INBOUND_POST_PROCESS:
     - Backfill outbound messages
     - Run AI sentiment (with retry on failure)
     - Generate draft if eligible (with retry on failure)
     - Trigger enrichment if needed
     - Process auto-booking
     - Update lead rollups
```

**Benefits:**
- **Webhook responds fast** (< 2s) → no external platform timeout/retry issues
- **Each task has independent retry** → sentiment failure doesn't re-run webhook
- **Task chaining** → can spawn sub-tasks (e.g., sentiment → draft → auto-send)
- **Observability** → BackgroundJob table shows status/attempts/errors for each task
- **Cost control** → can throttle/rate-limit expensive AI operations

**User Quote:**
> "We want to split up certain functions, if there is like really long functions. We want to split them up and have them call each other, right? Like for example, the enrichment piece. We want the when the webhook comes in, it pulls in the necessary information but it does different functions separately and it calls them so it will create a new sort of task so we don't hit the Vercel runtime errors."

## Objectives

* [ ] Extend BackgroundJobType enum for all post-processing stages
* [ ] Refactor GHL SMS webhook to minimal-write + enqueue pattern
* [ ] Refactor LinkedIn webhook to minimal-write + enqueue pattern
* [ ] Refactor SmartLead webhook to minimal-write + enqueue pattern
* [ ] Refactor Instantly webhook to minimal-write + enqueue pattern
* [ ] Create per-webhook post-process job handlers (composed of granular step functions; no job chaining yet)
* [ ] Add minimal observability for job health (logs + AIInteraction attribution)
* [ ] Test webhook timeout improvements
* [ ] Ensure idempotency and no duplicate processing

## Constraints

- **Backward compatibility:** Existing behavior must be preserved (same AI calls, same draft logic, same auto-reply gates)
- **Idempotency:** Webhooks can be retried by external platforms; must handle gracefully
- **No data loss:** Failed jobs must retry with exponential backoff (existing runner supports this)
- **Observability:** All AI operations must maintain telemetry (`AIInteraction` table)
- **Cost control:** Background jobs should respect rate limits and token budgets
- **Webhook SLA:** All webhooks must respond < 5s (ideally < 2s) to avoid external platform timeouts
- **Cron budget:** `/api/cron/background-jobs` has `maxDuration = 800`, but the runner self-limits per invocation (default `BACKGROUND_JOB_CRON_TIME_BUDGET_MS=240000` and `BACKGROUND_JOB_CRON_LIMIT=10`; both configurable)
- **Migration safety:** Changes must be deployable incrementally (per webhook, not all-or-nothing)
- **Email pattern parity:** Non-email webhooks should follow the same architecture as email (from Phase 31)

## Repo Reality Check (RED TEAM)

### What Exists Today

**Background Job Infrastructure (Phase 31):**
- `prisma/schema.prisma`: `BackgroundJob` model with distributed locking, retry backoff, status tracking
- `lib/background-jobs/runner.ts`: Job processor with time budgets, stale lock release, retry logic
- `app/api/cron/background-jobs/route.ts`: Cron endpoint (800s maxDuration) scheduled in `vercel.json`
- `lib/background-jobs/email-inbound-post-process.ts`: Reference implementation for email post-processing

**Current BackgroundJobType enum:**
```prisma
enum BackgroundJobType {
  EMAIL_INBOUND_POST_PROCESS
}
```

**Webhooks Needing Refactor:**
1. **GHL SMS** (`app/api/webhooks/ghl/sms/route.ts`):
   - Synchronous today: (a) best-effort contact hydration via GHL API, (b) conversation history fetch/import for first inbound, (c) sentiment/drafts/auto-reply evaluation, (d) auto-booking, (e) timezone + snooze detection, (f) follow-up pause + rollups
   - Has `maxDuration = 800` but still does all work inline

2. **LinkedIn** (`app/api/webhooks/linkedin/route.ts`):
   - Synchronous today: sentiment + draft generation, Clay enrichment triggers (phone), contact extraction, optional GHL contact sync, follow-up pause + rollups
   - Has `maxDuration = 800` but still does all work inline

3. **SmartLead** (`app/api/webhooks/smartlead/route.ts`):
   - Synchronous today: AI sentiment analysis/classification, timezone + snooze detection, auto-booking, draft generation + auto-send gating, follow-up pause + rollups
   - Has `maxDuration = 800` but still does all work inline

4. **Instantly** (`app/api/webhooks/instantly/route.ts`):
   - Synchronous today: AI sentiment classification, timezone + snooze detection, auto-booking, draft generation + auto-send gating, follow-up pause + rollups
   - Has `maxDuration = 800` but still does all work inline

**Email Webhook (Already Refactored):**
- `app/api/webhooks/email/route.ts`: Minimal write + enqueue EMAIL_INBOUND_POST_PROCESS
- Does NOT run sentiment/drafts inline (offloaded to background job)

**Shared Logic (Used by All Webhooks):**
- `lib/sentiment.ts`: AI sentiment classification + status updates
- `lib/ai-drafts.ts`: Two-step draft generation (Phase 30)
- `lib/auto-reply-gate.ts`: Safety checks for auto-sends
- `lib/auto-send-evaluator.ts`: Auto-send decision logic
- `lib/followup-engine.ts`: Pause/resume sequences, auto-booking
- `lib/clay-api.ts`: Enrichment triggers
- `lib/ghl-contacts.ts`: GHL contact sync
- `lib/timezone-inference.ts`: Timezone detection
- `lib/snooze-detection.ts`: Snooze intent detection
- `lib/lead-message-rollups.ts`: Lead field rollups

### What the Plan Assumes (Must Verify)

1. **Job granularity:** Should we have one job type per webhook (4 new types) OR one job type per operation (SENTIMENT_ANALYSIS, DRAFT_GENERATION, ENRICHMENT, etc.)?
   - **Decision:** Start with one job type per webhook (4 new types), keep email separate, and add a **cross-cutting lead scoring job type** that can be enqueued from any post-process handler (Phase 33 dependency).
   - Reason: simplest path to eliminate webhook timeouts; keeps logic close to channel quirks; still allows lead scoring to run as its own job to manage cost/latency.

2. **Task chaining:** Should jobs spawn follow-up jobs (sentiment → draft → auto-send) OR should one job do all steps?
   - **Decision:** One job does all steps (like EMAIL_INBOUND_POST_PROCESS), but keep the implementation split into internal helper functions and enforce per-step timeouts. Future: can split into stage-level jobs if any handler starts hitting maxDuration.

3. **Deduplication:** BackgroundJob has `dedupeKey` (unique). What should the key be?
   - **Decision:** `{clientId}:{messageId}:{jobType}` (one post-process job per message per type)

4. **Webhook idempotency:** If webhook retries before job runs, do we re-enqueue?
   - **Decision:** Webhook should be idempotent and safe to retry. Use provider-stable identifiers where available (see Data Model notes below) and rely on BackgroundJob `dedupeKey` as a second line of defense.

5. **Cron frequency:** Current `vercel.json` schedules background-jobs cron. What's the interval?
   - **Verified (2026-01-17):** `vercel.json` schedules `/api/cron/background-jobs` every minute (`* * * * *`)

### Verified Touch Points

File paths verified as of 2026-01-17:
- ✅ `prisma/schema.prisma` (BackgroundJob model exists)
- ✅ `lib/background-jobs/runner.ts` (job processor exists)
- ✅ `app/api/cron/background-jobs/route.ts` (cron exists)
- ✅ `lib/background-jobs/email-inbound-post-process.ts` (reference implementation)
- ✅ `app/api/webhooks/ghl/sms/route.ts` (GHL SMS webhook)
- ✅ `app/api/webhooks/linkedin/route.ts` (LinkedIn webhook)
- ✅ `app/api/webhooks/smartlead/route.ts` (SmartLead webhook)
- ✅ `app/api/webhooks/instantly/route.ts` (Instantly webhook)
- ✅ `app/api/webhooks/email/route.ts` (email webhook, already uses jobs)

### Vercel Runtime Notes (Docs Pointers)

- Goal: return webhook responses fast, and move slow work to async processing.
- Useful primitives:
  - Next.js `after()` for running *small* background tasks after sending the response (don’t use for long AI/enrichment pipelines).
  - Vercel `waitUntil` for deferring work beyond the response lifecycle (best for short follow-on work; still bound by function execution limits).
- References:
  - `https://nextjs.org/docs/app/api-reference/functions/after`
  - `https://vercel.com/docs/functions/wait-until`
  - `https://vercel.com/docs/functions/runtimes#max-duration`
- ✅ `vercel.json` (cron schedule includes `/api/cron/background-jobs`)

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-Risk Failure Modes

1. **Webhook deduplication race condition:**
   - **Risk:** Webhook arrives → message doesn't exist → insert Message → enqueue job. External platform retries same webhook 100ms later → message doesn't exist yet (DB replication lag) → duplicate Message + duplicate job.
   - **Mitigation:** Use provider-stable unique IDs when available (e.g., `Message.emailBisonReplyId` for EmailBison/SmartLead/Instantly). For LinkedIn, store Unipile `message.id` in a new `Message.unipileMessageId` `@unique` field. For GHL SMS, add a schema-backed `Message.webhookDedupeKey` and set it on insert so workflow webhook retries remain idempotent even without a provider message ID.

2. **Job starvation:**
   - **Risk:** High-volume channel (1000 SMS/hr) floods job queue → low-volume high-value channel (LinkedIn) gets starved.
   - **Mitigation:** Cron processes jobs FIFO by `runAt`. Future: can add priority field if needed.

3. **Lost webhook payloads:**
   - **Risk:** Webhook enqueues job with minimal data (just messageId). Job runs → needs webhook context (custom fields, attribution) → data not available.
   - **Mitigation:** Webhooks must persist ALL necessary context to Lead/Message records BEFORE enqueuing job. Job should only read from DB, never need original webhook payload.

4. **Duplicate AI calls on retry:**
   - **Risk:** Job runs sentiment → crashes before updating Message → retry runs sentiment again → double cost.
   - **Mitigation:** Make each step idempotent (check if sentiment already exists before running). EMAIL_INBOUND_POST_PROCESS already does this.

5. **Cascading job failures:**
   - **Risk:** Shared resource fails (OpenAI API down) → all jobs fail → retry storm → rate limits → more failures.
   - **Mitigation:** Use exponential backoff (runner already does this). Future: can add circuit breaker pattern.

6. **Orphaned drafts:**
   - **Risk:** Job generates draft → auto-send evaluation fails → draft sits in UI forever as "pending."
   - **Mitigation:** Wrap draft generation + auto-send in transaction. If auto-send fails, mark draft as "needs_review" (existing behavior).

7. **Cron timeout:**
   - **Risk:** Job queue grows faster than cron drains it (runner default time budget ~240s + limit 10) → lag, retries stacking, delayed follow-up automations.
   - **Mitigation:** Make per-job work bounded (timeouts around slow network calls), and tune `BACKGROUND_JOB_CRON_TIME_BUDGET_MS` / `BACKGROUND_JOB_CRON_LIMIT` as needed after load testing.

8. **Schema migration downtime:**
   - **Risk:** Add new BackgroundJobType enum → deploy code → old code doesn't recognize new enum → crashes.
   - **Mitigation:** Deploy schema changes first (add enum values), then deploy code that uses them. Prisma migrations are additive.

### Missing or Ambiguous Requirements

1. **Job retry limits:** EMAIL_INBOUND_POST_PROCESS uses `maxAttempts = 5`. Should all job types use same limit?
   - **Decision:** Yes, use 5 for all types. Can be made configurable later if needed.

2. **Job scheduling delay:** Should jobs run immediately (`runAt = now()`) or with a delay (e.g., 10s) to allow webhook deduplication?
   - **Decision:** Immediate (`runAt = now()`). Cron picks up jobs quickly, and deduplication is handled by DB constraints + dedupeKey.

3. **Partial failure handling:** If sentiment succeeds but draft generation fails, should we retry whole job or just draft step?
   - **Decision:** Retry whole job, but make each step idempotent (check if already done). This matches EMAIL_INBOUND_POST_PROCESS pattern.

4. **Observability:** How do we monitor job health? Alerts for high failure rates?
   - **Decision:** Phase 35 will include minimal observability (job logs + AIInteraction attribution). Alerting/dashboarding remains out of scope for now.
   - **Decision (human-confirmed):** Set `AIInteraction.source` to a job-type string (e.g., `background_job:SMS_INBOUND_POST_PROCESS`) while executing each job handler.

5. **Job payload size:** Should jobs store large context (full message transcript) or just IDs?
   - **Decision:** Just IDs. Jobs fetch data from DB. Keeps BackgroundJob table lean.

6. **Cron schedule:** What interval? Every minute? Every 5 minutes?
   - **Verified (2026-01-17):** every minute in `vercel.json` (`* * * * *`)

### Data Model & Migrations

**Schema changes needed:**
1. Add new BackgroundJobType enum values:
   - `SMS_INBOUND_POST_PROCESS`
   - `LINKEDIN_INBOUND_POST_PROCESS`
   - `SMARTLEAD_INBOUND_POST_PROCESS`
   - `INSTANTLY_INBOUND_POST_PROCESS`
   - `LEAD_SCORING_POST_PROCESS` (Phase 33; enqueue from post-process handlers)

2. No changes to BackgroundJob model (existing fields sufficient)

3. Message/provider dedupe fields (repo reality as of 2026-01-17):
   - `Message.emailBisonReplyId` is `@unique` and is already used for EmailBison **and** SmartLead/Instantly inbound dedupe (SmartLead/Instantly encode a stable reply handle into this field).
   - `Message.ghlId` is `@unique`, but the GHL workflow webhook payload often does **not** include the message ID; it is populated later via conversation export/import (“healing”).
   - **Decision (human-confirmed):** Add `Message.webhookDedupeKey String? @unique` and use it for GHL SMS webhook idempotency when no provider message ID exists.
     - Proposed format: `ghl_sms:${sha256(clientId + contactId + workflowId + rawDateCreated + rawCustomDate + rawCustomTime + normalizedBody)}`
   - LinkedIn currently has **no** stable external ID stored on `Message`; add `Message.unipileMessageId String? @unique` and store Unipile `payload.message.id` to harden idempotency.

### Repo Mismatches (Fix Before Implementation)

- `Message` uses `body` (not `content`), and `direction` values are `"inbound" | "outbound"` (not `"INBOUND" | "OUTBOUND"`).
- Sentiment is stored on `Lead.sentimentTag` (there is no `Message.sentiment` field).
- SmartLead/Instantly currently dedupe inbound messages via `Message.emailBisonReplyId` (there is no `Message.smartleadId` / `Message.instantlyId`).
- `Message.unipileMessageId` and `Message.webhookDedupeKey` do not exist yet (will be added in-schema as part of this phase).

### Testing / Validation Checklist

1. **Per webhook (4x):**
   - [ ] Send test webhook → verify Message created
   - [ ] Verify BackgroundJob enqueued (status = PENDING)
   - [ ] Trigger cron manually → verify job runs (status = RUNNING → SUCCEEDED)
   - [ ] Verify sentiment updated on Lead
   - [ ] Verify draft generated in AIDraft table
   - [ ] Verify no duplicate processing on webhook retry

2. **Error scenarios:**
   - [ ] OpenAI API fails → job retries with backoff
   - [ ] Job exceeds maxAttempts → status = FAILED, no more retries
   - [ ] Stale lock → released by next cron run

3. **Performance:**
   - [ ] Webhook response time < 2s (measure in Vercel logs)
   - [ ] Job processing time < 60s per job (measure in BackgroundJob table)

4. **Regression:**
   - [ ] Existing email webhook still works
   - [ ] All AI operations still logged to AIInteraction
   - [ ] Follow-up sequences still pause/resume correctly
   - [ ] Auto-booking still works

5. **Build verification:**
   - [x] `npm run lint` (no errors)
   - [x] `npm run build` (succeeds)
   - [x] `npm run db:push` (schema applied)

## Decisions (Human Confirmed)

- [x] Add a schema-backed dedupe key for GHL SMS webhook messages (`Message.webhookDedupeKey`) and use it for idempotent inserts when the webhook payload lacks a provider message ID.
- [x] Use job-type-level `AIInteraction.source` for background jobs (implemented as `background-job/<job-type>`) by setting the telemetry source around each job handler execution.

## Success Criteria

### Must-Have (Phase 35 Complete)

- [x] All four webhooks (GHL SMS, LinkedIn, SmartLead, Instantly) refactored to background job pattern
  **Status:** ✅ Implemented (webhooks persist Message/Lead and enqueue post-process jobs)
- [ ] Webhook response times < 5s (measured in Vercel logs)
  **Status:** Partial (GHL SMS verified on 2026-01-18 via `vercel curl` with p95 < 1s; other webhooks pending)
- [x] All AI operations (sentiment, drafts, and lead scoring where applicable) moved to background jobs
  **Status:** ✅ Implemented (AI work moved into `lib/background-jobs/*`)
- [x] BackgroundJobType enum includes all new job types
  **Status:** ✅ Implemented in `prisma/schema.prisma`
- [x] Job handlers created for each webhook type
  **Status:** ✅ Implemented in `lib/background-jobs/*-inbound-post-process.ts`
- [x] Runner updated to dispatch new job types
  **Status:** ✅ Implemented in `lib/background-jobs/runner.ts`
- [ ] All existing functionality preserved (sentiment, drafts, auto-reply, auto-booking)
  **Status:** Partial (build passed; verified email+sms background jobs executing in production; full end-to-end matrix still pending)
- [ ] No duplicate processing on webhook retries
  **Status:** Partial (schema-backed dedupe added; retry simulations not executed in this review)
- [x] All jobs logged with attempts/status/errors in BackgroundJob table
  **Status:** ✅ Verified in production on 2026-01-18 (jobs transitioning `PENDING` → `SUCCEEDED`, attempts recorded)
- [x] Build passes: `npm run lint`, `npm run build`, `npm run db:push`
  **Status:** ✅ Verified on 2026-01-18

### Should-Have (Quality Gates)

- [ ] Manual end-to-end test per webhook (send real test message → verify full flow)
- [ ] Job retry tested (simulate failure → verify backoff)
- [ ] Cron time budget tested (enqueue 50 jobs → verify all processed within reasonable time)
- [x] OpenAI telemetry verified (AIInteraction rows created with correct source attribution)

### Nice-to-Have (Future Phases)

- Job priority field (process high-value channels first)
- Circuit breaker pattern (stop retrying if upstream consistently fails)
- Job metrics dashboard (success rate, avg processing time, cost per job type)
- Per-workspace rate limits / quotas for AI operations
- Task chaining (split into smaller jobs: sentiment → scoring → draft → auto-send as separate jobs)

## Non-Goals (Explicitly Out of Scope)

- **Replacing cron with queue system:** Current cron-based approach is sufficient for now. Future: can migrate to dedicated queue (BullMQ, Inngest, etc.) if needed.
- **Real-time processing:** Background jobs run on cron schedule (every N minutes). Immediate processing not required.
- **Job cancellation:** No UI for canceling jobs. Jobs run to completion or max retries.
- **Webhook replay:** No admin UI for re-enqueueing failed webhooks. Must manually trigger via POST to webhook endpoint.
- **Full workflow engine:** Keep orchestration simple (no complex DAG builder/UI). If job chaining is added later, keep it minimal and idempotent.

## Subphase Index

* a — Schema extension and shared utilities
* b — GHL SMS webhook refactor
* c — LinkedIn webhook refactor
* d — SmartLead webhook refactor
* e — Instantly webhook refactor
* f — Testing, validation, and deployment
* g — Orchestration pattern + cross-phase verification (RED TEAM)
* h — Schema-backed dedupe + job telemetry attribution

---

## Dependencies

- Phase 31 (completed) — Background job infrastructure exists
- Phase 30 (completed) — Two-step draft generation pipeline (used by job handlers)
- Prisma schema access (for enum additions)
- Vercel cron configuration (verify/update schedule if needed)

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Webhook deduplication race | Duplicate messages/jobs | Use unique DB constraints + dedupeKey |
| Job starvation | High-value leads delayed | FIFO queue (future: add priority) |
| Lost context in jobs | Jobs can't process | Persist all context to DB before enqueueing |
| Cron timeout | Jobs not processed | Time budget + deadlineMs safety buffer |
| Schema migration downtime | Crashes on deploy | Deploy schema first, then code |
| OpenAI API failures | All jobs fail | Exponential backoff + max retries |
| Partial failure handling | Duplicate AI calls | Idempotent job steps (check before running) |

## Estimated Scope

- **Schema changes:** Small (add 4 enum values)
- **Job handlers:** Medium (4 new files, similar to email-inbound-post-process.ts)
- **Webhook refactors:** Large (4 webhooks, each needs careful extraction)
- **Testing:** Large (end-to-end tests per webhook + error scenarios)

**Total:** Large phase, approximately 3-5 days of focused work.

**Incremental Delivery Strategy:**
1. Phase 35a: Schema + shared utilities (foundation)
2. Phase 35b: GHL SMS (highest volume webhook)
3. Phase 35c: LinkedIn (enrichment complexity)
4. Phase 35d: SmartLead (similar to email)
5. Phase 35e: Instantly (similar to email)
6. Phase 35f: Testing + deployment

Each subphase can be deployed independently (per webhook), reducing deployment risk.

---

## Phase 35 Summary

### Phase Status: IMPLEMENTED (VALIDATION PENDING)

**Date:** 2026-01-18

### What Was Accomplished

This phase implemented the “webhook → enqueue → cron runner executes job handlers” architecture for non-email webhooks (plus lead scoring integration). Production latency and end-to-end behavior still require validation (see `docs/planning/phase-35/review.md`).

**Subphases covered (implementation + planning):**
1. **Phase 35a** — Schema extension and shared utilities design
   - Defined 4 new BackgroundJobType enum values (SMS, LinkedIn, SmartLead, Instantly)
   - Designed shared `enqueueBackgroundJob()` utility pattern
   - Planned runner dispatch logic updates
   - Planned LEAD_SCORING_POST_PROCESS integration

2. **Phase 35b** — GHL SMS webhook refactor plan
   - Detailed handler implementation (`sms-inbound-post-process.ts`)
   - Webhook refactor strategy (minimal-write + enqueue pattern)
   - Testing scenarios documented (5 scenarios per webhook)

3. **Phase 35c** — LinkedIn webhook refactor plan
   - Handler design with LinkedIn-specific operations (Clay enrichment, GHL sync, contact extraction)
   - Webhook refactor strategy
   - Testing scenarios documented

4. **Phase 35d** — SmartLead webhook refactor plan
   - Handler design (email channel, similar to email-inbound-post-process)
   - Webhook refactor strategy
   - Testing scenarios documented

5. **Phase 35e** — Instantly webhook refactor plan
   - Handler design (email channel, similar to SmartLead)
   - Webhook refactor strategy
   - Testing scenarios documented

6. **Phase 35f** — Testing, validation, and deployment plan
   - Comprehensive test matrix (20 webhook scenarios)
   - Performance verification strategy (response time < 2s target)
   - Error handling and edge case testing
   - Deployment checklist and rollback procedures

7. **Phase 35g** — Orchestration pattern + cross-phase verification (RED TEAM)
   - Lead scoring integration strategy across all channels
   - Job chaining patterns for multi-step workflows
   - Cross-phase dependency verification (Phase 33 scoring + Phase 35 webhooks)

8. **Phase 35h** — Schema-backed dedupe + job telemetry attribution
   - Webhook deduplication strategy (`Message.webhookDedupeKey`)
   - AIInteraction source attribution pattern for background jobs
   - Idempotency design for webhook retries

### Key Architectural Decisions

1. **Background Job Pattern:** All webhooks will follow the email webhook pattern from Phase 31:
   - Webhook: minimal synchronous processing (< 2s) + enqueue job
   - Background job: all AI/enrichment operations with independent timeout budgets

2. **Job Granularity:** One job type per webhook (not per operation) for initial implementation:
   - `SMS_INBOUND_POST_PROCESS`
   - `LINKEDIN_INBOUND_POST_PROCESS`
   - `SMARTLEAD_INBOUND_POST_PROCESS`
   - `INSTANTLY_INBOUND_POST_PROCESS`
   - Plus: `LEAD_SCORING_POST_PROCESS` (integrated from Phase 33)

3. **Deduplication Strategy:**
   - Message deduplication: platform-specific unique IDs (`ghlId`, `unipileMessageId`, etc.)
   - Job deduplication: `dedupeKey = {clientId}:{messageId}:{jobType}`
   - Webhook retry handling: unique constraints prevent duplicates

4. **Idempotency Pattern:**
   - Each job step checks if already done before executing
   - Example: Check if `message.sentiment` exists before re-running sentiment analysis
   - Prevents duplicate AI calls on job retries

5. **Lead Scoring Integration:**
   - Lead scoring runs as separate background job (not inline in webhook post-process)
   - Enqueued after message processing completes
   - Prevents webhook-type job handlers from timing out on scoring

6. **Telemetry Attribution:**
   - AIInteraction source field: `background-job/<job-type>` (set in the background job runner)
   - Enables cost tracking per job type
   - Preserved from existing inline implementation

### Implementation Artifacts

**Planning Documents:**
- `docs/planning/phase-35/plan.md` (this file) - Root plan with architecture
- `docs/planning/phase-35/a/plan.md` - Schema extension plan
- `docs/planning/phase-35/b/plan.md` - GHL SMS refactor plan
- `docs/planning/phase-35/c/plan.md` - LinkedIn refactor plan
- `docs/planning/phase-35/d/plan.md` - SmartLead refactor plan
- `docs/planning/phase-35/e/plan.md` - Instantly refactor plan
- `docs/planning/phase-35/f/plan.md` - Testing & deployment plan
- `docs/planning/phase-35/g/plan.md` - Orchestration pattern plan
- `docs/planning/phase-35/h/plan.md` - Dedupe + telemetry plan

**Code Artifacts (Created):**
- ✅ `prisma/schema.prisma` (BackgroundJobType additions; `Message.unipileMessageId`; `Message.webhookDedupeKey`)
- ✅ `lib/background-jobs/enqueue.ts`
- ✅ `lib/background-jobs/runner.ts` (dispatches all post-process job types; sets `AIInteraction.source` per job)
- ✅ `lib/background-jobs/sms-inbound-post-process.ts`
- ✅ `lib/background-jobs/linkedin-inbound-post-process.ts`
- ✅ `lib/background-jobs/smartlead-inbound-post-process.ts`
- ✅ `lib/background-jobs/instantly-inbound-post-process.ts`
- ✅ `lib/background-jobs/lead-scoring-post-process.ts`
- ✅ `lib/webhook-dedupe.ts` (GHL SMS webhook dedupe)
- ✅ Webhook refactors:
  - `app/api/webhooks/ghl/sms/route.ts`
  - `app/api/webhooks/linkedin/route.ts`
  - `app/api/webhooks/smartlead/route.ts`
  - `app/api/webhooks/instantly/route.ts`

**Existing Infrastructure (Used):**
- ✅ `lib/background-jobs/email-inbound-post-process.ts` (reference implementation)
- ✅ `app/api/cron/background-jobs/route.ts` (cron endpoint)
- ✅ `BackgroundJob` model in schema (idempotency + retry infrastructure)

### Current Repository State

**Schema:**
```prisma
enum BackgroundJobType {
  EMAIL_INBOUND_POST_PROCESS
  SMS_INBOUND_POST_PROCESS
  LINKEDIN_INBOUND_POST_PROCESS
  SMARTLEAD_INBOUND_POST_PROCESS
  INSTANTLY_INBOUND_POST_PROCESS
  LEAD_SCORING_POST_PROCESS
}
```

**Webhooks (Current State):**
- `app/api/webhooks/ghl/sms/route.ts` — Message insert + enqueue `SMS_INBOUND_POST_PROCESS`
- `app/api/webhooks/linkedin/route.ts` — Message insert + enqueue `LINKEDIN_INBOUND_POST_PROCESS`
- `app/api/webhooks/smartlead/route.ts` — Message insert + enqueue `SMARTLEAD_INBOUND_POST_PROCESS`
- `app/api/webhooks/instantly/route.ts` — Message insert + enqueue `INSTANTLY_INBOUND_POST_PROCESS`
- `app/api/webhooks/email/route.ts` — ✅ Already uses background jobs (Phase 31)

### Next Steps for Validation

1. Execute Phase 35f (Testing & validation):
   - Run the end-to-end test matrix (20 scenarios).
   - Measure webhook latency in Vercel logs (target: p95 < 5s).
   - Verify BackgroundJob processing: retries/backoff, stale lock release, and overall throughput.
   - Verify AI telemetry attribution (`AIInteraction.source = background-job/<job-type>`).

2. Production rollout / monitoring:
   - Monitor BackgroundJob failure rate, queue depth, and lag.
   - Pay special attention to GHL SMS webhook latency for new/no-SMS leads (GHL history export still runs in the webhook path today).

### Benefits (After Validation)

- Faster and more reliable webhook handling by moving AI/enrichment off the request path.
- Retry isolation via BackgroundJob attempts/backoff per job type.
- Clearer cost attribution by job type via `AIInteraction.source`.

---

**Implementation complete; validation pending. See `docs/planning/phase-35/review.md`.**
