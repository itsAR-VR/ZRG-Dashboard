# Phase 31c — Audit Email Webhook for Blocking Work, Move to Background Jobs

## Focus
Ensure the email webhook returns 200 OK within 25 seconds (Vercel's initial response requirement) by identifying and moving long-running work to background jobs.

## Inputs
- From 31b: EmailBison fetch is now resilient
- Error observed: `Vercel Runtime Timeout Error: Task timed out after 800 seconds`
- The email webhook log shows EMAIL_SENT events taking 6+ minutes
- Background job infrastructure exists: `BackgroundJob` table + `/api/cron/background-jobs` route
- Email webhook already enqueues `EMAIL_INBOUND_POST_PROCESS` jobs for slow work

## Work

### 1. Audit current webhook flow for blocking operations
Review `app/api/webhooks/email/route.ts` for operations that can take >5s:

**Critical path (must be fast):**
- Parse payload ✓
- Find client ✓
- Dedupe check ✓
- Upsert lead (now with race handling) ✓
- Create message ✓
- Return 200 OK

**Potentially slow (should be background):**
- AI sentiment classification (`analyzeInboundEmailReply`) — can take 10-30s
- AI draft generation (`generateResponseDraft`) — can take 30-120s
- Enrichment (EmailBison lead fetch, signature extraction, Clay API) — can take 10-60s
- GHL contact sync (`ensureGhlContactIdForLead`, `syncGhlContactPhoneForLead`) — can take 5-15s
- Follow-up automation (`autoStartMeetingRequestedSequenceIfEligible`) — usually fast but has DB writes

### 2. Review current background job usage
The webhook already calls `enqueueEmailInboundPostProcessJob` at the end. Check what this job does:
- Located in `/api/cron/background-jobs` route
- Should handle: enrichment, GHL sync, Clay, draft generation

### 3. Move remaining slow operations to background
If not already backgrounded:
- **AI sentiment classification**: Should happen in background job, webhook uses quick heuristics
- **Draft generation**: Already moved to background in Phase 20 (commented out in webhook)
- **Enrichment**: Should be in `EMAIL_INBOUND_POST_PROCESS` job

### 4. Fast-path webhook response
Ensure webhook returns quickly with minimal processing:
```typescript
// Fast path - do minimal work synchronously
const lead = await upsertLead(...);
const message = await createMessage(...);

// Quick sentiment (regex-based, no AI)
const quickSentiment = getQuickSentiment(body);
await prisma.lead.update({
  where: { id: lead.id },
  data: { sentimentTag: quickSentiment, status: getQuickStatus(quickSentiment) }
});

// Enqueue everything else
await enqueueEmailInboundPostProcessJob({...});

// Return immediately
return NextResponse.json({ success: true, leadId: lead.id, postProcessEnqueued: true });
```

### 5. Verify background job handler
Check `/api/cron/background-jobs` handles `EMAIL_INBOUND_POST_PROCESS`:
- AI sentiment classification with full transcript
- Draft generation
- Enrichment pipeline (EmailBison, signature, Clay)
- GHL contact sync
- Follow-up automation

### 6. Add timeout safety
Even with backgrounding, add a safety timeout to the webhook:
```typescript
export const maxDuration = 60; // Reduce from 800 to 60 seconds
// If we hit this, something is wrong with the fast path
```

## Output

**Audit completed. Findings:**

1. **Current background job coverage (already in `lib/background-jobs/email-inbound-post-process.ts`):**
   - Backfill outbound emails from EmailBison
   - Snooze detection
   - Auto-booking
   - Enrichment pipeline (message content, EmailBison, signature, Clay)
   - GHL contact sync
   - Follow-up automation (resume awaiting enrichment)
   - Draft generation (with auto-send evaluation)
   - Slack DM notifications

2. **Slow operations still on webhook critical path:**
   - **AI sentiment classification** (`analyzeInboundEmailReply` at lines ~557, ~1617): 10-30s
   - **AI sentiment fallback** (`classifySentiment` at line ~581): 5-15s
   - Both `handleLeadReplied` and `handleUntrackedReply` call these

3. **Quick operations already in webhook (fine to keep):**
   - `isOptOutText()` - regex-based opt-out detection
   - `detectBounce()` - regex-based bounce detection
   - `reply.interested` flag check - already from provider
   - Lead/campaign upsert - DB only
   - Message create - DB only
   - Background job enqueue - DB only

4. **Recommendation for 31g implementation:**
   - Webhook should use quick sentiment: Blacklist (opt-out/bounce), Interested (provider flag), or "Pending" placeholder
   - Move AI classification to `runEmailInboundPostProcessJob`
   - Background job should:
     a. Run full AI sentiment classification
     b. Update `Lead.sentimentTag` and `Lead.status`
     c. Run subsequent dependent work (draft generation, auto-send)
   - Webhook `maxDuration` can be reduced from 800s to 60s after this change

5. **No code changes made in this subphase** - this is an audit. Implementation deferred to 31g.

## Handoff
Audit complete. 31d can proceed with Unipile disconnection notifications (which is independent). The actual webhook optimization implementation will be done in 31g.
