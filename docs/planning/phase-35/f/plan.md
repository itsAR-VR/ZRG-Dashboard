# Phase 35f — Testing, Validation, and Deployment

## Focus

Comprehensive testing and validation of all webhook refactors, performance verification, error scenario testing, and production deployment preparation with rollback procedures.

## Inputs

- Phases 35a-e output: All webhooks refactored, all job handlers created
- Files modified:
  - `prisma/schema.prisma` (4 new BackgroundJobType values)
  - `lib/background-jobs/enqueue.ts` (shared utility)
  - `lib/background-jobs/runner.ts` (updated dispatch logic)
  - `lib/background-jobs/sms-inbound-post-process.ts` (new)
  - `lib/background-jobs/linkedin-inbound-post-process.ts` (new)
  - `lib/background-jobs/smartlead-inbound-post-process.ts` (new)
  - `lib/background-jobs/instantly-inbound-post-process.ts` (new)
  - `app/api/webhooks/ghl/sms/route.ts` (refactored)
  - `app/api/webhooks/linkedin/route.ts` (refactored)
  - `app/api/webhooks/smartlead/route.ts` (refactored)
  - `app/api/webhooks/instantly/route.ts` (refactored)

## Work

### 1. Build Verification

**Run all build checks:**

```bash
# Lint check
npm run lint

# TypeScript check
npx tsc --noEmit

# Build check
npm run build

# Schema sync check
npm run db:push
```

**Expected results:**
- Lint: Pass (warnings OK, no errors)
- TypeScript: Pass (no type errors)
- Build: Success
- Schema: "Already in sync" or successful migration

**If any fail:**
- Fix errors before proceeding
- Do NOT deploy with build failures

### 2. End-to-End Testing (Per Webhook)

**Test matrix:** 4 webhooks × 5 scenarios = 20 tests

#### Test Scenario Template (Repeat for Each Webhook)

**Webhook: [GHL SMS | LinkedIn | SmartLead | Instantly]**

##### Scenario 1: Happy Path (Positive Sentiment → Draft → Auto-Send)

1. Send inbound message with positive sentiment (e.g., "Yes, I'm interested in a call")
2. **Webhook verification:**
   - Check Vercel logs: response time < 5s (ideally < 2s)
   - Response: `{ success: true }`
3. **Database verification:**
   - Message created with correct `direction = INBOUND`, `channel = [sms|email|linkedin]`
   - BackgroundJob created with:
     - `type = [SMS|LINKEDIN|SMARTLEAD|INSTANTLY]_INBOUND_POST_PROCESS`
     - `status = PENDING`
     - `clientId`, `leadId`, `messageId` all populated
     - `dedupeKey = {clientId}:{messageId}:{jobType}`
4. **Trigger cron:**
   ```bash
   curl -X POST https://<domain>/api/cron/background-jobs \
     -H "Authorization: Bearer $CRON_SECRET"
   ```
5. **Job processing verification:**
   - BackgroundJob `status = RUNNING` (during processing)
   - BackgroundJob `status = SUCCEEDED` (after completion)
   - `finishedAt` timestamp populated
   - `attempts = 1`
6. **AI operations verification:**
   - Message `sentiment` field populated (e.g., "Meeting Requested")
   - Lead `status` updated (e.g., "Hot Lead")
   - AIDraft created with `status = PENDING` or `APPROVED`
   - AIInteraction rows created (2 rows: strategy + generation from Phase 30 two-step pipeline)
7. **Auto-send verification (if applicable):**
   - AIDraft `status = APPROVED`
   - Message created with `direction = OUTBOUND`, `isDraft = false`
   - External API called (GHL/SmartLead/Instantly/Unipile)

##### Scenario 2: Neutral Sentiment (No Draft Generated)

1. Send inbound message with neutral sentiment (e.g., "Thanks")
2. Webhook responds < 5s, job enqueued
3. Cron processes job
4. **Verification:**
   - Sentiment = "Neutral"
   - Lead status = "Neutral" or unchanged
   - **No AIDraft created** (neutral messages don't generate drafts per `shouldGenerateDraft()` logic)
   - Lead rollup updated (`lastMessageAt`, etc.)

##### Scenario 3: Negative Sentiment (No Auto-Send)

1. Send inbound message with negative sentiment (e.g., "Not interested, remove me")
2. Webhook responds < 5s, job enqueued
3. Cron processes job
4. **Verification:**
   - Sentiment = "Not Interested"
   - Lead status = "Not Interested"
   - **No draft generated** (or draft created but NOT auto-sent per auto-reply gate)
   - Follow-ups paused

##### Scenario 4: Webhook Retry (Deduplication)

1. Send initial inbound message
2. Webhook responds, job enqueued
3. **Re-send exact same webhook payload** (simulate external platform retry)
4. **Verification:**
   - Webhook responds `{ success: true }` (no error)
   - **No duplicate Message created** (unique constraint on platform ID)
   - **No duplicate BackgroundJob created** (dedupeKey constraint)
   - Vercel logs show "already exists" or similar

##### Scenario 5: Job Retry (OpenAI Failure)

1. **Temporarily break OpenAI API key** (set `OPENAI_API_KEY=invalid`)
2. Send inbound message
3. Webhook responds < 5s, job enqueued
4. Cron processes job → **job fails** (OpenAI API error)
5. **Verification:**
   - BackgroundJob `status = PENDING` (will retry)
   - `attempts = 1`
   - `lastError` contains error message (e.g., "OpenAI API key invalid")
   - `runAt` updated to future timestamp (exponential backoff)
6. **Restore OpenAI API key** (set correct value)
7. Wait for next cron run (or trigger manually)
8. **Verification:**
   - Job processes successfully
   - `status = SUCCEEDED`
   - `attempts = 2`
   - Sentiment populated correctly

**Run this test matrix for all 4 webhooks.**

**Tracking:** Use a checklist or spreadsheet to track results.

Example:

| Webhook | Scenario 1 | Scenario 2 | Scenario 3 | Scenario 4 | Scenario 5 |
|---------|------------|------------|------------|------------|------------|
| GHL SMS | ✅ | ✅ | ✅ | ✅ | ✅ |
| LinkedIn | ✅ | ✅ | ✅ | ✅ | ✅ |
| SmartLead | ✅ | ✅ | ✅ | ✅ | ✅ |
| Instantly | ✅ | ✅ | ✅ | ✅ | ✅ |

### 3. Performance Verification

**Measure webhook response times:**

1. Send 10 messages per webhook (40 total)
2. Extract response times from Vercel logs
3. Calculate:
   - Average response time per webhook
   - P95 response time per webhook
   - Max response time per webhook

**Target:** All webhooks should have:
- Average < 2s
- P95 < 3s
- Max < 5s

**Compare to pre-refactor baselines** (if available):
- Pre-refactor: webhooks likely averaged 15-30s (with AI inline)
- Post-refactor: should be < 2s

**Document improvements:**

Example:
```
GHL SMS Webhook Performance:
- Before: avg 18s, p95 25s, max 45s
- After:  avg 1.2s, p95 1.8s, max 2.5s
- Improvement: 93% faster (15x speedup)
```

### 4. Job Processing Performance

**Measure background job processing times:**

1. Check BackgroundJob table for recent jobs
2. Calculate processing time: `finishedAt - startedAt`
3. Group by job type, calculate:
   - Average processing time
   - P95 processing time
   - Max processing time

**Target:** All job types should complete within 60s average.

**Acceptable ranges:**
- SMS jobs: 10-30s (sentiment + draft)
- LinkedIn jobs: 20-40s (sentiment + draft + enrichment)
- Email jobs (SmartLead/Instantly): 15-35s (sentiment + draft)

**If any job type consistently exceeds 60s:**
- Investigate which operation is slow (check AIInteraction table for token counts)
- Consider optimizing prompts or splitting into sub-jobs (future work)

### 5. Observability Verification

**AI Telemetry (AIInteraction Table):**

1. Send test messages across all channels
2. Query AIInteraction table:
   ```sql
   SELECT
     featureId,
     model,
     COUNT(*) as call_count,
     SUM(promptTokens + completionTokens) as total_tokens,
     SUM(costInCents) as total_cost_cents
   FROM AIInteraction
   WHERE createdAt > NOW() - INTERVAL '1 hour'
   GROUP BY featureId, model;
   ```
3. **Verify:**
   - `featureId` includes both `draft.strategy.*` and `draft.generate.*` (Phase 30 two-step)
   - `featureId` includes `sentiment.classify.*`
   - `source` field attributed correctly (e.g., `SMS_INBOUND_POST_PROCESS`)
   - Token counts reasonable (no runaway costs)

**Background Job Health:**

1. Query BackgroundJob table:
   ```sql
   SELECT
     type,
     status,
     COUNT(*) as count,
     AVG(attempts) as avg_attempts,
     MAX(attempts) as max_attempts
   FROM BackgroundJob
   WHERE createdAt > NOW() - INTERVAL '24 hours'
   GROUP BY type, status;
   ```
2. **Verify:**
   - Most jobs have `status = SUCCEEDED`
   - Average attempts ≈ 1.0 (few retries)
   - Max attempts < 5 (no jobs hitting max retry limit)
   - No jobs stuck in `RUNNING` status (stale locks cleaned up)

### 6. Regression Testing

**Verify no regressions in existing functionality:**

- [ ] Follow-up sequences pause on inbound reply
- [ ] Auto-booking triggers on meeting acceptance phrases
- [ ] Lead status updates based on sentiment
- [ ] Slack notifications work (if enabled)
- [ ] CRM drawer shows correct message history
- [ ] Inbox attention counts update correctly
- [ ] Email body cleaning works (quoted text removed)
- [ ] Contact extraction from LinkedIn messages works
- [ ] Clay enrichment triggers for LinkedIn leads
- [ ] GHL contact sync works for cross-channel leads

**Test method:** Spot-check each feature with manual tests or review existing automated test suite (if available).

### 7. Error Handling & Edge Cases

**Test edge cases:**

1. **Orphaned message (lead deleted):**
   - Create message → delete lead → trigger job
   - Expected: Job handles gracefully (logs error, doesn't crash)

2. **Missing workspace settings:**
   - Client without `workspaceSettings` record
   - Expected: Job uses defaults, doesn't crash

3. **Invalid message content:**
   - Empty message body, null content
   - Expected: Sentiment analysis handles gracefully (defaults to Neutral)

4. **Concurrent job processing:**
   - Enqueue same job twice (different dedupeKeys)
   - Expected: Both jobs process independently, no conflicts

5. **Cron timeout:**
   - Enqueue 300 jobs
   - Trigger cron → hits time budget
   - Expected: Processes as many as possible, remaining jobs picked up next run

### 8. Deployment Preparation

**Pre-deployment checklist:**

- [ ] All tests passing (20 webhook scenarios + regressions)
- [ ] Performance targets met (webhooks < 2s avg)
- [ ] No build errors (`npm run lint`, `npm run build`)
- [ ] Schema changes applied (`npm run db:push`)
- [ ] Environment variables verified (CRON_SECRET, OPENAI_API_KEY, etc.)
- [ ] Cron schedule verified in `vercel.json` (≤ 5 min interval)
- [ ] Rollback plan documented (see below)

**Deployment steps:**

1. **Deploy schema changes first** (Prisma migration):
   ```bash
   npm run db:push
   ```
   - Verify in production DB (Supabase)
   - New BackgroundJobType enum values should be present

2. **Deploy code to Vercel:**
   ```bash
   vercel --prod
   ```
   - Monitor deployment logs for errors
   - Verify deployment completes successfully

3. **Smoke test in production:**
   - Send 1 test message per webhook (4 total)
   - Verify webhooks respond < 2s
   - Verify jobs enqueued
   - Trigger cron manually (if safe) or wait for scheduled run
   - Verify jobs processed successfully

4. **Monitor for 1 hour post-deployment:**
   - Watch Vercel logs for errors
   - Check BackgroundJob table for failed jobs
   - Check AIInteraction table for cost spikes
   - Monitor Slack/email for user-reported issues

**If issues detected:**
- Proceed to rollback plan immediately

### 9. Rollback Plan

**If refactor causes production issues:**

**Option 1: Code Rollback (Fastest)**

1. Revert to previous Vercel deployment:
   ```bash
   vercel rollback
   ```
2. Webhooks will resume inline processing (pre-refactor behavior)
3. Background jobs will fail (handlers don't exist in old code) → set to FAILED status manually
4. No data loss (messages/leads/drafts already created)

**Option 2: Selective Rollback (Per Webhook)**

If only one webhook is problematic (e.g., LinkedIn causing issues):

1. Revert that specific webhook file to inline processing
2. Keep other webhooks on background jobs
3. Deploy updated code
4. Monitor issue resolution

**Option 3: Disable Background Jobs Temporarily**

1. Set `CRON_SECRET` to invalid value (disables cron endpoint)
2. Webhooks will enqueue jobs but jobs won't process
3. Revert webhooks to inline processing
4. Re-enable cron after fix deployed

**Important:**
- Schema changes (BackgroundJobType enum) are safe to keep (won't break old code)
- Job handler files can remain (not executed if webhooks don't enqueue)

### 10. Documentation

**Update `CLAUDE.md` with background job architecture:**

Add section:

```markdown
## Background Job Architecture

Webhooks (GHL SMS, LinkedIn, SmartLead, Instantly) use async background jobs for AI processing:

1. **Webhook receives event** → validates → creates Message record → enqueues BackgroundJob → returns 200 OK (< 2s)
2. **Cron processes jobs** (`/api/cron/background-jobs`, every 1-5 min) → runs sentiment, drafts, enrichment → updates Lead/Message
3. **Job types:**
   - `SMS_INBOUND_POST_PROCESS` (`lib/background-jobs/sms-inbound-post-process.ts`)
   - `LINKEDIN_INBOUND_POST_PROCESS` (`lib/background-jobs/linkedin-inbound-post-process.ts`)
   - `SMARTLEAD_INBOUND_POST_PROCESS` (`lib/background-jobs/smartlead-inbound-post-process.ts`)
   - `INSTANTLY_INBOUND_POST_PROCESS` (`lib/background-jobs/instantly-inbound-post-process.ts`)
   - `EMAIL_INBOUND_POST_PROCESS` (`lib/background-jobs/email-inbound-post-process.ts`) — Phase 31

**Benefits:** Avoids Vercel timeout issues, enables retry isolation, improves webhook reliability.

**Monitoring:** Check `BackgroundJob` table for job status, `AIInteraction` for costs.
```

## Output

### Verification Results

**Build Status:**
- [ ] `npm run lint`: PASS
- [ ] `npm run build`: PASS
- [ ] `npm run db:push`: PASS

**Test Results:**
- [ ] GHL SMS (5/5 scenarios pass)
- [ ] LinkedIn (5/5 scenarios pass)
- [ ] SmartLead (5/5 scenarios pass)
- [ ] Instantly (5/5 scenarios pass)
- [ ] Regression tests: PASS
- [ ] Edge cases: PASS

**Performance Metrics:**
- [ ] Webhook avg response time < 2s (all webhooks)
- [ ] Job avg processing time < 60s (all types)
- [ ] No cost spikes (AIInteraction totals normal)

**Deployment Status:**
- [ ] Schema deployed to production
- [ ] Code deployed to Vercel
- [ ] Smoke tests pass in production
- [ ] 1-hour monitoring complete (no issues)

### Deliverables

1. ✅ Test results spreadsheet (20 webhook scenarios)
2. ✅ Performance benchmarks (before/after comparison)
3. ✅ Deployment checklist (completed)
4. ✅ Rollback procedures (documented)
5. ✅ Updated `CLAUDE.md` (architecture section)

### Success Criteria

- All webhook refactors deployed to production
- Webhook response times < 2s (measured improvement)
- No functional regressions
- Background job processing stable (>95% success rate)
- AI telemetry preserved (AIInteraction rows created)
- Rollback plan tested and ready if needed

## Handoff

**Phase 35 Complete.**

All webhooks refactored to background job pattern:
- ✅ GHL SMS
- ✅ LinkedIn
- ✅ SmartLead
- ✅ Instantly

**Key Outcomes:**
- **Eliminated Vercel timeout issues** (webhooks respond < 2s vs 15-30s pre-refactor)
- **Improved reliability** (retry isolation, independent timeout budgets)
- **Maintained functionality** (no regressions in sentiment, drafts, auto-reply)
- **Preserved observability** (AIInteraction telemetry intact)

**Future Enhancements (Out of Scope for Phase 35):**
- Job priority queue (process high-value leads first)
- Task chaining (split sentiment → draft → auto-send into separate jobs)
- Circuit breaker pattern (stop retrying if upstream fails)
- Real-time job processing (replace cron with event-driven queue like Inngest/BullMQ)
- Job metrics dashboard (success rates, processing times, costs by type)

**Monitoring Recommendations:**
- Set up alerts for BackgroundJob failure rate > 10%
- Monitor AIInteraction costs daily (flag if >2x normal spend)
- Track webhook response times (alert if p95 > 5s)
- Review stale jobs weekly (status=RUNNING for >1 hour)

---

**End of Phase 35 Planning.**
