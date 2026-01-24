# Phase 53b — Email Webhook Burst Hardening (Enqueue-First + Bounded Processor)

## Focus
Eliminate `/api/webhooks/email` 504/60s runtime timeouts during EMAIL_SENT bursts by changing the ingestion contract:

1) **Ingest quickly** (dedupe + persist minimal event) and return 2xx.
2) **Process asynchronously** via a bounded, retryable worker (cron-driven).

## Inputs
- `app/api/webhooks/email/route.ts` (current dispatcher + handlers)
- `app/api/cron/background-jobs/route.ts` (existing cron runner entrypoint)
- Prisma models: `BackgroundJob` (requires `leadId` + `messageId`, so cannot be used as “raw event queue” without schema changes)
- `lib/lead-matching.ts` (cross-channel lead creation/matching)
- Follow-up triggers: `lib/followup-automation.ts`, `lib/followup-engine.ts`
- Observed burst pattern: ~177 webhook 504s across 18:13–18:14 UTC

## Work
### Pre-Flight Conflict Check
- [x] Ran `git status` — no unexpected modifications to files touched in this subphase (`prisma/schema.prisma`, `app/api/webhooks/email/route.ts`, cron runner).
- [x] Confirmed Phase 51/52 uncommitted files were not modified in this subphase.

1. **Add a dedicated “WebhookEvent” queue model**
   - New Prisma model (name TBD: `WebhookEvent` / `InboundWebhookEvent`) with:
     - `provider` (e.g. `INBOXXIA`)
     - `eventType` (EMAIL_SENT, LEAD_REPLIED, etc)
     - `dedupeKey` (unique)
     - `receivedAt`, `processedAt`, `attempts`, `maxAttempts`, `runAt`
     - `status` (PENDING/RUNNING/SUCCESS/FAILED)
     - `lastError` (text, truncated)
     - Minimal normalized fields needed for processing (workspace_id, campaign id, lead email/id, scheduled_email.id, reply.id, sender email)
     - Optional `payload` JSON (only if size-safe; otherwise store a trimmed subset)
   - Ensure this model **does not require** `leadId`/`messageId` at ingestion time.

2. **Change webhook handler for high-volume events (start with EMAIL_SENT)**
   - Replace the current synchronous work for `EMAIL_SENT` with:
     - parse → dedupeKey → `WebhookEvent.upsert(...)` → return 200.
   - Keep `LEAD_REPLIED` behavior as-is initially (lower volume + more latency-sensitive), unless burst risk exists there too.
   - Add a feature flag: `INBOXXIA_EMAIL_SENT_ASYNC=1` to gate behavior.

3. **Create a bounded processor in cron**
   - Extend `app/api/cron/background-jobs` to:
     - Pull N pending events (e.g., 25–100) ordered by `runAt`.
     - Lock rows (set `lockedAt/lockedBy`) to prevent concurrent processing.
     - Process each event with strict per-event budgets (timeouts for external calls; no AI calls here).
     - On failure: increment attempts, set `runAt` via backoff, store safe `lastError`.
     - After `maxAttempts`: mark FAILED and emit a Slack alert (safe metadata only).

4. **Move heavy follow-up triggers off ingestion path**
   - For EMAIL_SENT: do not run `autoStartNoResponseSequenceOnOutbound` synchronously in webhook ingestion.
   - Instead, the processor should:
     - Persist the outbound message
     - Enqueue any follow-up/background jobs required (idempotently)

5. **Idempotency and dedupe contracts**
   - DedupeKey conventions:
     - `inboxxia:EMAIL_SENT:<scheduled_email.id>`
     - `inboxxia:LEAD_REPLIED:<reply.id>`
   - Processing must re-check existing `Message` uniques (`inboxxiaScheduledEmailId`, `emailBisonReplyId`) before writing.

6. **Backpressure + DB safety**
   - Ensure webhook ingestion does **at most one DB write** on the hot path.
   - Ensure processor is bounded per run and does not starve interactive traffic.

## Output
- **Schema:** added `WebhookEvent` durable queue + enums `WebhookProvider` and `WebhookEventStatus` in `prisma/schema.prisma`.
- **Ingestion:** `app/api/webhooks/email/route.ts` now supports enqueue-first handling for `EMAIL_SENT` behind `INBOXXIA_EMAIL_SENT_ASYNC` (one DB upsert, returns immediately).
- **Processor:** added bounded queue draining:
  - `lib/webhook-events/runner.ts` (locks + retries/backoff + stale lock release; safe no-op if table isn’t migrated yet)
  - `lib/webhook-events/inboxxia-email-sent.ts` (idempotent EMAIL_SENT processing; re-applies rollups + followup start even when Message already exists)
- **Cron integration:** `lib/background-jobs/runner.ts` now drains webhook events first (bounded) before standard `BackgroundJob` processing.

## Coordination Notes
**Conflicts:** none in this subphase (touched files were clean).  
**Rollout dependency:** `INBOXXIA_EMAIL_SENT_ASYNC` must remain **off** until the `WebhookEvent` table is migrated (`db:push`), otherwise webhook enqueue will 500.  

## Handoff
Proceed to Phase 53c to eliminate inbox counts statement timeouts and further reduce `/` request-path latency under load.
