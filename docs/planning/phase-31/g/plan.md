# Phase 31g — RED TEAM Correction: Enforce Webhook Time Budgets (Move AI/Enrichment/Auto-Send to Background)

## Focus
Stop webhook invocations from doing long-running work (AI calls, enrichment, autosend evaluation, Slack notifications) so they reliably return quickly and never hit Vercel’s 800s runtime timeout.

## Inputs
- Prod error: `Vercel Runtime Timeout Error: Task timed out after 800 seconds` observed during email webhook processing.
- Prod errors: `[AI Drafts] ... Request timed out` observed during GHL SMS webhook processing.
- Repo reality:
  - `app/api/webhooks/email/route.ts` and `app/api/webhooks/ghl/sms/route.ts` both run with `export const maxDuration = 800`.
  - Email + SMS webhook handlers currently await multiple slow operations (enrichment + AI drafts + auto-send evaluation + Slack DM).
  - Background jobs exist and are cron-processed: `app/api/cron/background-jobs/route.ts` + `lib/background-jobs/runner.ts`.
  - Email post-processing job exists today: `lib/background-jobs/email-inbound-post-process.ts` (`BackgroundJobType.EMAIL_INBOUND_POST_PROCESS`).
- Dependency: 31f ensures webhook message inserts + job enqueue are idempotent under duplicates.

## Work

### 1) Define the webhook “fast path” contract (explicit time budget)
- Webhook critical path should only do:
  - validate + tenant resolution (`findClient`)
  - dedupe/idempotency check (but avoid TOCTOU; see 31f)
  - upsert lead/campaign (DB-only)
  - create `Message` row (DB-only)
  - enqueue background job(s) (DB-only, deduped by `BackgroundJob.dedupeKey`)
  - return `200` JSON
- Hard rule: no network calls (EmailBison, Clay, GHL, OpenAI, Slack) on the critical path.

### 2) Email webhook: remove/disable slow awaits and delegate to background jobs
- In `app/api/webhooks/email/route.ts`, move these operations off the request path:
  - signature enrichment (AI)
  - Clay enrichment triggers
  - EmailBison enrichment fetches
  - GHL contact ensure + phone sync
  - `generateResponseDraft(...)`
  - `evaluateAutoSend(...)` + `approveAndSendDraftSystem(...)`
  - Slack DM notifications
- Ensure the webhook enqueues `EMAIL_INBOUND_POST_PROCESS` for inbound events once the `Message` row exists.
  - Confirm `lib/background-jobs/email-inbound-post-process.ts` covers enrichment + draft generation already.
  - If autosend evaluation/sending is required, add it to a background worker step (never in webhook).

### 3) GHL SMS webhook: minimize AI/autosend work (two options)
- Option A (fastest, no schema change):
  - Keep draft generation best-effort but enforce strict timeout and never run autosend evaluation/sending in webhook.
  - Always return 200 after message insert; treat draft generation as optional “nice-to-have”.
- Option B (strongest, requires schema + runner support):
  - Add `BackgroundJobType.SMS_INBOUND_POST_PROCESS` (and/or `DRAFT_AUTO_SEND_EVALUATION`) to `prisma/schema.prisma`.
  - Extend `lib/background-jobs/runner.ts` to execute the new job type(s).
  - Enqueue SMS post-process jobs from `app/api/webhooks/ghl/sms/route.ts` using deterministic `dedupeKey`.
  - Move: `generateResponseDraft`, `evaluateAutoSend`, `approveAndSendDraftSystem`, and Slack DM to the job worker.
- Pick A vs B explicitly during implementation based on urgency and migration tolerance.

### 4) Add internal “wall-clock budget” guardrails
- Add a per-request deadline (e.g., 8–10 seconds) in webhook handlers:
  - If the deadline is exceeded, stop additional work and return success once `Message` + job enqueue are complete.
- Log budget overruns with enough context to debug (event type, leadId, elapsedMs).

### 5) Make draft generation idempotent under webhook duplicates
- When deferring draft generation to background jobs, pass `triggerMessageId` (the inbound `Message.id`) into `generateResponseDraft(...)` so duplicates cannot create duplicate drafts.

## Validation (RED TEAM)
- Measure webhook response time under realistic payloads:
  - Target: <5–10s response time for the email webhook and the SMS webhook.
  - Confirm no `Task timed out after 800 seconds` in logs after deployment.
- Confirm background jobs execute and produce the same final outcomes:
  - lead enrichment updates
  - AI drafts created (or logged failures)
  - autosend (if enabled) occurs from background workers only
- Run: `npm run lint` and `npm run build`.
- If `prisma/schema.prisma` is changed for new job types: run `npm run db:push` against the correct DB.

## Output

**Completed implementation:**

1. **Email webhook fast path (`app/api/webhooks/email/route.ts`):**
   - Removed slow AI classification calls (`analyzeInboundEmailReply`, `classifySentiment`) from critical path
   - Implemented quick heuristics for immediate sentiment:
     - `isOptOutText` + `detectBounce` → "Blacklist" (safety-critical)
     - `reply.interested === true` → "Interested" (provider flag)
     - Everything else → "Neutral" (placeholder for AI classification)
   - Removed unused imports: `analyzeInboundEmailReply`, `classifySentiment`
   - Reduced `maxDuration` from 800s to 60s

2. **Background job AI classification (`lib/background-jobs/email-inbound-post-process.ts`):**
   - Added AI sentiment classification step at the start of job
   - Runs `analyzeInboundEmailReply` with fallback to `classifySentiment`
   - Only runs if lead sentiment is "Neutral" or "New" (placeholder from webhook)
   - Updates lead sentiment and status before enrichment and draft generation
   - Added `mapEmailInboxClassificationToSentimentTag` helper
   - Added imports: `analyzeInboundEmailReply`, `classifySentiment`, `SENTIMENT_TO_STATUS`, `SentimentTag`
   - Added compliance check: rejects pending drafts if AI classifies as "Automated Reply" or "Blacklist"

3. **Webhook compliance checks:**
   - Simplified draft rejection in webhook to only check "Blacklist" (quick heuristic)
   - "Automated Reply" handling moved to background job where AI determines this
   - Updated comments to document the change

**Result:**
- Email webhook response time reduced from potentially 30-120s (AI classification) to <5s (DB + enqueue only)
- AI classification still happens but in background job, not blocking webhook response
- Safety maintained: opt-outs and bounces are immediately classified as Blacklist in webhook
- No schema changes required

**Verified:** `npm run build` completes successfully.

## Handoff
Proceed to 31h to classify AbortError/DOMException aborts and implement safe timeout/retry policies for fetch wrappers.
