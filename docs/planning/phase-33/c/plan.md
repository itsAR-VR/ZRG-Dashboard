# Phase 33c — Pipeline Integration

## Focus

Wire the lead scoring engine into the message processing pipeline so leads are automatically scored when new inbound messages arrive, via background jobs (to avoid webhook runtime timeouts).

## Inputs

- Scoring engine from subphase b (`scoreLeadFromConversation()`)
- Existing webhook handlers: `app/api/webhooks/email/route.ts`, `app/api/webhooks/ghl/sms/route.ts`, `app/api/webhooks/linkedin/route.ts`
- Existing sentiment analysis flow (runs after message insertion)
- Background jobs architecture (Phase 31 today; Phase 35 expands it across all channels)

## Work

1. **Identify integration points:**
   - Score only on inbound messages (outbound-only threads remain unscored/null)
   - If lead is Blacklist/opt-out, skip AI and set `overallScore=1`
   - Prefer background job execution (email already uses background jobs; Phase 35 generalizes this pattern)

2. **Create scoring trigger function:**
   ```typescript
   // lib/lead-scoring.ts
   export async function enqueueLeadScoringJob(opts: { clientId: string; leadId: string; messageId: string }): Promise<void>
   ```
   - Enqueues a background job (dedupe-safe) rather than running AI inline
   - Job type: `LEAD_SCORING_POST_PROCESS`
   - Job handler:
     - Fetches recent messages for the lead (across all channels)
     - Calls `scoreLeadFromConversation()`
     - Updates Lead record with new scores + `scoredAt`

3. **Add job enqueue to post-process flows (not inline webhooks):**
   - Email: enqueue from `lib/background-jobs/email-inbound-post-process.ts` (not from the webhook route)
   - SMS + LinkedIn: enqueue from their post-process job handlers (Phase 35), or from existing webhook code as a temporary bridge if Phase 35 isn’t landed yet (must be non-blocking and safe)

4. **Scoring strategy decisions:**
   - Decision (v1): **re-score on every inbound message** (no debounce), using `gpt-5-nano` and strict timeouts/budgets.

5. **Handle multi-channel leads:**
   - Lead may have messages across SMS, Email, LinkedIn
   - Scoring should consider ALL messages for the lead, not just current channel
   - Fetch messages across channels when scoring

## Output

**Completed 2026-01-17:**

1. Added `LEAD_SCORING_POST_PROCESS` to `BackgroundJobType` enum in `prisma/schema.prisma` (line 91)

2. Created `lib/background-jobs/lead-scoring-post-process.ts`:
   - `runLeadScoringPostProcessJob()` - background job handler that calls `scoreLead()`
   - Logs scoring results (fit, intent, overall) or disqualification status

3. Updated `lib/background-jobs/runner.ts`:
   - Added import for `runLeadScoringPostProcessJob`
   - Added case handler for `LEAD_SCORING_POST_PROCESS` job type (lines 128-134)

4. Added `enqueueLeadScoringJob()` to `lib/lead-scoring.ts` (lines 461-493):
   - Creates dedupe key `lead_scoring:{leadId}:{messageId}` to prevent duplicates
   - Checks for existing pending/running job before creating new one

5. Updated `lib/background-jobs/email-inbound-post-process.ts`:
   - Added import for `enqueueLeadScoringJob` (line 44)
   - Enqueue scoring job at end of post-process (lines 1011-1022)
   - Fire-and-forget with error logging (doesn't fail parent job)

6. Ran `npm run db:push` — enum already in sync

## Handoff

Email channel now automatically enqueues lead scoring jobs on inbound messages. SMS and LinkedIn will be integrated in Phase 35 when their background job infrastructure is built. Subphase d will add UI components to display and filter by lead scores.
