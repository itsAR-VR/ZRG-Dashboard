# Phase 35 — Review

## Summary

- Shipped webhook → enqueue → background-job post-processing for GHL SMS, LinkedIn, SmartLead, and Instantly.
- Added schema-backed webhook dedupe (`Message.webhookDedupeKey`) and LinkedIn message id (`Message.unipileMessageId`) plus new `BackgroundJobType` values.
- Updated background job runner dispatch and set job-type-level AI telemetry source.
- Quality gates: `npm run lint`, `npm run build`, and `npm run db:push` all passed on 2026-01-18.
- Production follow-up: Verified background jobs are executing and job-level AI telemetry is being recorded after deploying to Vercel on 2026-01-18. Webhook p95 latency is still not measured here.

## What Shipped

- Schema:
  - `prisma/schema.prisma` (new `BackgroundJobType` values; `Message.unipileMessageId`; `Message.webhookDedupeKey`)
- Webhooks refactored to enqueue background jobs:
  - `app/api/webhooks/ghl/sms/route.ts`
  - `app/api/webhooks/linkedin/route.ts`
  - `app/api/webhooks/smartlead/route.ts`
  - `app/api/webhooks/instantly/route.ts`
- Background job infrastructure additions:
  - `lib/background-jobs/enqueue.ts`
  - `lib/background-jobs/runner.ts`
  - `lib/webhook-dedupe.ts`
- New job handlers:
  - `lib/background-jobs/sms-inbound-post-process.ts`
  - `lib/background-jobs/linkedin-inbound-post-process.ts`
  - `lib/background-jobs/smartlead-inbound-post-process.ts`
  - `lib/background-jobs/instantly-inbound-post-process.ts`
  - `lib/background-jobs/lead-scoring-post-process.ts`

## Verification

### Commands

- `git status --porcelain=v1` — collected (Sun Jan 18 10:07:39 +03 2026)
- `git diff --name-only` — collected (Sun Jan 18 10:07:39 +03 2026)
- `npm run lint` — PASS (warnings only) (Sun Jan 18 10:07:39 +03 2026)
- `npm run build` — PASS (Sun Jan 18 10:07:39 +03 2026)
- `npm run db:push` — PASS (already in sync) (Sun Jan 18 10:07:39 +03 2026)

### Notes

- Working tree contains many modified/untracked files beyond Phase 35 scope; this review focuses on Phase 35’s architecture refactor artifacts listed above.
- Lint warnings include `@next/next/no-img-element` and `react-hooks/exhaustive-deps` (no errors).
- `next build` emitted a Next.js workspace root warning (multiple lockfiles) and a middleware deprecation warning, but build succeeded.

## Success Criteria → Evidence

1. All four webhooks (GHL SMS, LinkedIn, SmartLead, Instantly) refactored to background job pattern
   - Evidence: `app/api/webhooks/ghl/sms/route.ts`, `app/api/webhooks/linkedin/route.ts`, `app/api/webhooks/smartlead/route.ts`, `app/api/webhooks/instantly/route.ts`
   - Status: met

2. Webhook response times < 5s (measured in Vercel logs)
   - Evidence: not collected in this review (requires Vercel logs / live testing)
   - Status: not met (not verified)

3. All AI operations (sentiment, drafts, and lead scoring where applicable) moved to background jobs
   - Evidence: job handlers in `lib/background-jobs/*-inbound-post-process.ts` and `lib/background-jobs/lead-scoring-post-process.ts`; webhooks enqueue jobs via `lib/background-jobs/enqueue.ts`
   - Status: met

4. BackgroundJobType enum includes all new job types
   - Evidence: `prisma/schema.prisma` includes `SMS_INBOUND_POST_PROCESS`, `LINKEDIN_INBOUND_POST_PROCESS`, `SMARTLEAD_INBOUND_POST_PROCESS`, `INSTANTLY_INBOUND_POST_PROCESS`, `LEAD_SCORING_POST_PROCESS`
   - Status: met

5. Job handlers created for each webhook type
   - Evidence: `lib/background-jobs/sms-inbound-post-process.ts`, `lib/background-jobs/linkedin-inbound-post-process.ts`, `lib/background-jobs/smartlead-inbound-post-process.ts`, `lib/background-jobs/instantly-inbound-post-process.ts`
   - Status: met

6. Runner updated to dispatch new job types
   - Evidence: `lib/background-jobs/runner.ts` imports and dispatches all new handlers
   - Status: met

7. All existing functionality preserved (sentiment, drafts, auto-reply, auto-booking)
   - Evidence: build passed; functional behavior not executed/verified end-to-end in this review
   - Status: partial

8. No duplicate processing on webhook retries
   - Evidence: schema unique keys (`Message.emailBisonReplyId`, `Message.unipileMessageId`, `Message.webhookDedupeKey`) + background job `dedupeKey` uniqueness; retry behavior not simulated in this review
   - Status: partial

9. All jobs logged with attempts/status/errors in BackgroundJob table
   - Evidence: schema model `BackgroundJob` (Phase 31) + runner updates attempts/status/lastError (`lib/background-jobs/runner.ts`); not exercised with real jobs in this review
   - Status: partial

10. Build passes: `npm run lint`, `npm run build`, `npm run db:push`
   - Evidence: command runs above
   - Status: met

## Plan Adherence

- Planned vs implemented deltas:
  - AIInteraction `source` format: plan mentions `background_job:<TYPE>`; implementation sets `background-job/<type>` in `lib/background-jobs/runner.ts` (still job-type-level attribution).
  - GHL SMS webhook no longer performs any conversation-history sync on the critical path; best-effort SMS history sync runs in the `SMS_INBOUND_POST_PROCESS` background job for short replies with no outbound context (see `lib/background-jobs/sms-inbound-post-process.ts`).
  - Inbound post-process handlers previously checked `message.direction === "OUTBOUND"` while webhooks store `"inbound"`/`"outbound"`; fixed in the post-review patch set (see below).

## Risks / Rollback

- Risk: `SMS_INBOUND_POST_PROCESS` may occasionally run a heavy GHL history sync (for short replies with no outbound context), increasing job runtime/queue latency.
  - Mitigation: keep heuristic narrow; tune `GHL_EXPORT_MAX_PAGES` / `GHL_EXPORT_MAX_MESSAGES` and/or disable via `SMS_POST_PROCESS_HISTORY_SYNC_ENABLED=false` if needed.
- Rollback: revert webhook routes to prior behavior (keep additive schema + job types; leave cron runner intact).

## Follow-ups

- Execute Phase 35f test matrix (20 scenarios) and record results.
  - **Status:** Test results template created at `docs/planning/phase-35/test-results.md`
- Verify webhook p95 latency in Vercel logs for each channel (especially GHL SMS new leads).
  - **Status:** Requires production monitoring
- Verify `AIInteraction.source` values by triggering jobs and querying DB (ensure job-type-level attribution is correct and consistent).
  - **Status:** Source format is `background-job/<type-kebab>` (URL-style pattern, consistent with cron routes)
- Reconcile message direction casing in job handlers vs webhook inserts.
  - **Status:** FIXED (2026-01-18) - Changed all 4 job handlers to use lowercase `"outbound"` check

## Post-Review Fixes Applied (2026-01-18)

1. **Direction casing fix**: All job handlers now check `direction === "outbound"` (lowercase) to match webhook inserts.
   - Files: `sms-inbound-post-process.ts`, `linkedin-inbound-post-process.ts`, `smartlead-inbound-post-process.ts`, `instantly-inbound-post-process.ts`

2. **GHL SMS webhook critical-path hardening**: Removed conversation-history sync/import from the webhook entirely; added best-effort history sync in `SMS_INBOUND_POST_PROCESS` for short replies with no outbound context.
   - Files: `app/api/webhooks/ghl/sms/route.ts`, `lib/background-jobs/sms-inbound-post-process.ts`
   - Configurable via `SMS_POST_PROCESS_HISTORY_SYNC_ENABLED` env var (default: true)

3. **LinkedIn webhook deduplication**: Now stores `unipileMessageId` and uses it for unique lookups.
   - File: `app/api/webhooks/linkedin/route.ts`

4. **Prisma type fix**: Changed `findUnique` to `findFirst` for `aiDraftId` queries (compound unique constraint).
   - Files: `actions/email-actions.ts`, `actions/message-actions.ts`, `lib/system-sender.ts`

5. **Telemetry wrapping**: Added per-job `withAiTelemetrySource` in runner for AI attribution.
   - File: `lib/background-jobs/runner.ts`

6. **Test results template**: Created `docs/planning/phase-35/test-results.md` for manual verification tracking.

## Production Verification (2026-01-18)

### Findings

- Production `zrg-dashboard.vercel.app` was previously failing `/api/cron/background-jobs` with Prisma `DataMapperError` (`SMS_INBOUND_POST_PROCESS` missing from generated enum), which prevented the queue from draining.
- Deployed updated build to production: `zrg-dashboard-hpk4bnhol-zrg.vercel.app` (deployment `dpl_9S7PKxuEtYDG1qsJS2zsp5TD3sfL`).
- After deploy, `/api/cron/background-jobs` resumed processing jobs (observed via Vercel runtime logs) and `BackgroundJob` statuses started transitioning from `PENDING` → `SUCCEEDED`.

### Evidence (DB)

- Background jobs are being processed:
  - As of 2026-01-18, `BackgroundJob` shows `EMAIL_INBOUND_POST_PROCESS` and `SMS_INBOUND_POST_PROCESS` jobs moving to `SUCCEEDED` with `attempts = 1` (no retries observed).
- Job-type-level AI attribution is working:
  - `AIInteraction.source` includes `background-job/email-inbound-post-process`, `background-job/sms-inbound-post-process`, and `background-job/lead-scoring-post-process` (no errors observed in the sampled window).

### Remaining

- Measure webhook p95 latency (<5s) for each webhook route via Vercel metrics/logs.
  - Partial: GHL SMS verified on 2026-01-18 via `vercel curl` (`/api/webhooks/ghl/test`, n=21) with p95 < 1s.
- Complete end-to-end test matrix for LinkedIn / SmartLead / Instantly in a controlled test workspace.
