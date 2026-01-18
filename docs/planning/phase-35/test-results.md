# Phase 35 — Test Results

**Date:** 2026-01-18
**Status:** Partial (Production Verification In Progress)

## Build Verification

| Check | Status | Notes |
|-------|--------|-------|
| `npm run lint` | PASS | Warnings only (pre-existing) |
| `npm run build` | PASS | Compiled successfully |
| `npm run db:push` | PASS | Schema in sync |

## Test Matrix (20 Scenarios)

### Legend
- [ ] Not tested
- [?] Tested with issues
- [x] Tested and passed

### GHL SMS Webhook

| Scenario | Status | Notes |
|----------|--------|-------|
| 1. Happy Path (Positive → Draft → Auto-Send) | [ ] | |
| 2. Neutral Sentiment (No Draft) | [ ] | |
| 3. Negative Sentiment (No Auto-Send) | [ ] | |
| 4. Webhook Retry (Deduplication) | [ ] | |
| 5. Job Retry (OpenAI Failure) | [ ] | |

### LinkedIn Webhook

| Scenario | Status | Notes |
|----------|--------|-------|
| 1. Happy Path (Positive → Draft → Auto-Send) | [ ] | |
| 2. Neutral Sentiment (No Draft) | [ ] | |
| 3. Negative Sentiment (No Auto-Send) | [ ] | |
| 4. Webhook Retry (Deduplication) | [ ] | |
| 5. Job Retry (OpenAI Failure) | [ ] | |

### SmartLead Webhook

| Scenario | Status | Notes |
|----------|--------|-------|
| 1. Happy Path (Positive → Draft → Auto-Send) | [ ] | |
| 2. Neutral Sentiment (No Draft) | [ ] | |
| 3. Negative Sentiment (No Auto-Send) | [ ] | |
| 4. Webhook Retry (Deduplication) | [ ] | |
| 5. Job Retry (OpenAI Failure) | [ ] | |

### Instantly Webhook

| Scenario | Status | Notes |
|----------|--------|-------|
| 1. Happy Path (Positive → Draft → Auto-Send) | [ ] | |
| 2. Neutral Sentiment (No Draft) | [ ] | |
| 3. Negative Sentiment (No Auto-Send) | [ ] | |
| 4. Webhook Retry (Deduplication) | [ ] | |
| 5. Job Retry (OpenAI Failure) | [ ] | |

## Performance Metrics

### Webhook Response Times

| Webhook | Avg | P95 | Max | Target | Status |
|---------|-----|-----|-----|--------|--------|
| GHL SMS | ~0.70s | ~0.97s | ~1.38s | <2s avg, <3s p95, <5s max | [x] |
| LinkedIn | - | - | - | <2s avg, <3s p95, <5s max | [ ] |
| SmartLead | - | - | - | <2s avg, <3s p95, <5s max | [ ] |
| Instantly | - | - | - | <2s avg, <3s p95, <5s max | [ ] |

**Notes:** GHL SMS timings measured on 2026-01-18 via `vercel curl` against production (`/api/webhooks/ghl/test`, n=21).

### Background Job Processing Times

| Job Type | Avg | P95 | Max | Target | Status |
|----------|-----|-----|-----|--------|--------|
| SMS_INBOUND_POST_PROCESS | ~1.3s | ~2.0s | ~2.0s | 10-30s | [x] |
| LINKEDIN_INBOUND_POST_PROCESS | - | - | - | 20-40s | [ ] |
| SMARTLEAD_INBOUND_POST_PROCESS | - | - | - | 15-35s | [ ] |
| INSTANTLY_INBOUND_POST_PROCESS | - | - | - | 15-35s | [ ] |
| EMAIL_INBOUND_POST_PROCESS | ~2.1s | ~3.7s | ~4.4s | 10-30s | [x] |
| LEAD_SCORING_POST_PROCESS | ~4.3s | ~7.2s | ~7.3s | 10-30s | [x] |

## Observability Verification

### AI Telemetry (AIInteraction Table)

```sql
SELECT
  featureId,
  source,
  model,
  COUNT(*) as call_count,
  SUM(promptTokens + completionTokens) as total_tokens,
  SUM("costInCents") as total_cost_cents
FROM "AIInteraction"
WHERE "createdAt" > NOW() - INTERVAL '1 hour'
GROUP BY featureId, source, model
ORDER BY call_count DESC;
```

**Expected `source` values:**
- `background-job/sms-inbound-post-process`
- `background-job/linkedin-inbound-post-process`
- `background-job/smartlead-inbound-post-process`
- `background-job/instantly-inbound-post-process`

| Verification | Status | Notes |
|--------------|--------|-------|
| `featureId` includes draft.strategy.* | [ ] | |
| `featureId` includes draft.generate.* | [ ] | |
| `featureId` includes sentiment.classify.* | [ ] | |
| `source` attributed to job type | [x] | Observed `background-job/*` sources (email, sms, lead-scoring) in `AIInteraction` |
| Token counts reasonable | [ ] | |

### Background Job Health

```sql
SELECT
  type,
  status,
  COUNT(*) as count,
  AVG(attempts) as avg_attempts,
  MAX(attempts) as max_attempts
FROM "BackgroundJob"
WHERE "createdAt" > NOW() - INTERVAL '24 hours'
GROUP BY type, status
ORDER BY type, status;
```

| Verification | Status | Notes |
|--------------|--------|-------|
| Most jobs SUCCEEDED | [x] | Queue draining; majority of processed jobs are `SUCCEEDED` |
| Avg attempts ≈ 1.0 | [x] | No retries observed in sampled window |
| Max attempts < 5 | [x] | No retries observed in sampled window |
| No stale RUNNING jobs | [x] | No long-running `RUNNING` jobs observed |

## Regression Testing

| Feature | Status | Notes |
|---------|--------|-------|
| Follow-up sequences pause on inbound | [ ] | |
| Auto-booking on meeting acceptance | [ ] | |
| Lead status updates on sentiment | [ ] | |
| Slack notifications | [ ] | |
| CRM drawer message history | [ ] | |
| Inbox attention counts | [ ] | |
| Email body cleaning | [ ] | |
| Contact extraction (LinkedIn) | [ ] | |
| GHL contact sync | [ ] | |

## Edge Cases

| Test Case | Status | Notes |
|-----------|--------|-------|
| Orphaned message (lead deleted) | [ ] | |
| Missing workspace settings | [ ] | |
| Invalid/empty message content | [ ] | |
| Concurrent job processing | [ ] | |
| Cron timeout (300+ jobs) | [ ] | |

## Deployment Checklist

- [x] All build checks pass
- [ ] Test matrix complete (20/20 scenarios)
- [ ] Performance targets met
- [ ] Schema deployed to production
- [ ] Code deployed to Vercel
- [ ] Production smoke tests pass
- [ ] 1-hour monitoring complete

## Issues Found & Fixes Applied

### Issue 1: Message Direction Casing Mismatch
**Description:** Job handlers checked `direction === "OUTBOUND"` but webhooks store lowercase `"outbound"`.
**Fix:** Updated all 4 job handlers to use lowercase direction check.
**Files Changed:**
- `lib/background-jobs/sms-inbound-post-process.ts`
- `lib/background-jobs/linkedin-inbound-post-process.ts`
- `lib/background-jobs/smartlead-inbound-post-process.ts`
- `lib/background-jobs/instantly-inbound-post-process.ts`

### Issue 2: GHL SMS Webhook Latency Risk
**Description:** GHL SMS webhook previously risked slow responses due to conversation-history fetch/import on first-contact events; also, short replies like "yes/ok/sure" need outbound context for accurate sentiment.
**Fix:** Removed history sync/import from the webhook critical path and moved best-effort history sync into `SMS_INBOUND_POST_PROCESS` (only when the inbound reply is short and there's no outbound context in DB).
**Files Changed:**
- `app/api/webhooks/ghl/sms/route.ts`
- `lib/background-jobs/sms-inbound-post-process.ts`

### Issue 3: LinkedIn Webhook Missing unipileMessageId
**Description:** LinkedIn messages weren't storing the Unipile message ID for deduplication.
**Fix:** Added `unipileMessageId` to message creation and updated duplicate check to use it.
**Files Changed:**
- `app/api/webhooks/linkedin/route.ts`

### Issue 4: aiDraftId findUnique Type Error
**Description:** Prisma complained about using `aiDraftId` alone in `findUnique` after schema changes.
**Fix:** Changed to `findFirst` in 4 locations.
**Files Changed:**
- `actions/email-actions.ts`
- `actions/message-actions.ts` (2 places)
- `lib/system-sender.ts`

## Rollback Plan

If issues detected post-deployment:

1. **Code Rollback:** `vercel rollback`
2. **Selective Rollback:** Revert specific webhook file
3. **Disable Jobs:** Set `CRON_SECRET` to invalid value

Schema changes are safe to keep (won't break old code).

---

**Reviewer:** _________________
**Date:** _________________
**Sign-off:** [ ] Approved for Production
