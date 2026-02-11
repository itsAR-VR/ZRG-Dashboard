# Phase 132 — Review

## Summary
- Shipped response timing instrumentation for setter vs AI (per-inbound anchor), including deterministic AI delay attribution and scheduled-vs-actual drift.
- Surfaced per-lead timing in the CRM drawer and added a dedicated "Response Timing" analytics tab with booking conversion buckets.
- Fixed Analytics custom date windows to use local-day boundaries and aligned CRM date range end to exclusive `windowTo` semantics.
- Verified: `npm test`, `npm run lint`, `npm run build`, `npm run db:push` all pass.

## What Shipped
- Data model: `prisma/schema.prisma` (`ResponseTimingEvent`, `Message` composite index)
- Deterministic delay attribution: `lib/background-jobs/delayed-auto-send.ts` (`computeChosenDelaySeconds`)
- Processor + cron:
  - `lib/response-timing/processor.ts`
  - `app/api/cron/response-timing/route.ts`
  - `vercel.json` (cron schedule)
- Backfill: `scripts/backfill-response-timing.ts`
- Per-lead UI:
  - `actions/response-timing-actions.ts`
  - `components/dashboard/crm-drawer.tsx`
- Analytics correlation:
  - `actions/response-timing-analytics-actions.ts`
  - `components/dashboard/analytics-view.tsx`
- Analytics window correctness:
  - `components/dashboard/analytics-view.tsx` (custom date parsing)
  - `actions/analytics-actions.ts` (CRM `dateTo` exclusive filtering)
- Tests:
  - `lib/__tests__/response-timing.test.ts`
  - `lib/__tests__/response-timing-analytics.test.ts`

## Verification

### Commands
- `npm test` — pass (2026-02-10, rerun after window fixes)
- `npm run lint` — pass (warnings only) (2026-02-10, rerun after window fixes)
- `npm run build` — pass (2026-02-10, rerun after window fixes)
- `npm run db:push` — pass (2026-02-10)

### Notes
- Build emits existing CSS optimization warnings and a deprecated middleware convention warning; no build failures.

## Success Criteria → Evidence

1. For any lead, the UI shows recent inbound anchors with setter + AI timing + chosen delay + scheduled runAt.
   - Evidence: `actions/response-timing-actions.ts`, `components/dashboard/crm-drawer.tsx`
   - Status: met

2. Analytics exposes timing buckets vs booking rate (setter timing, AI chosen delay, AI drift).
   - Evidence: `actions/response-timing-analytics-actions.ts`, `components/dashboard/analytics-view.tsx`
   - Status: met

3. Timing attribution is correct for inbound streaks (only last inbound before an outbound response is used).
   - Evidence: `lib/response-timing/processor.ts` anchor insertion logic (next message must be outbound in same lead+channel)
   - Status: met

4. Quality gates pass: `npm test`, `npm run lint`, `npm run build`, and `npm run db:push` (schema applied).
   - Evidence: command results recorded above
   - Status: met

## Plan Adherence
- Planned vs implemented deltas:
  - High-water mark optimization for processor scans was not implemented; batching + lookback remain bounded via env vars.
  - Backfill script prefers `DIRECT_URL` but supports an explicit `DATABASE_URL` fallback when enabled via `--allow-pooler`.

## Risks / Rollback
- Processor can be disabled by setting `RESPONSE_TIMING_BATCH_SIZE=0`.
- Backfill is idempotent; reruns should not duplicate anchors due to `inboundMessageId` uniqueness.

## Follow-ups
- Decide whether analytics should be lead-level (current) or event-level (multiple anchors per lead) for conversion buckets.
- If desired, extend the Response Timing tab to show pending/booked-no-timestamp counts and sample sizes per bucket inline.
