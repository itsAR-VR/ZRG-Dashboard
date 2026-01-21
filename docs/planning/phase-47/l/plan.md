# Phase 47l — AI Auto-Send Delay: Campaign Setting + Background Job Scheduling

## Focus

Add a configurable delay for **AI-managed campaigns** (`EmailCampaign.responseMode = AI_AUTO_SEND`) so the system waits a chosen amount of time **after an inbound reply** before auto-sending the AI draft.

This must be implemented via background jobs (using `runAt`) — no sleeps in webhook/job request paths.

## Inputs

- Campaign model: `prisma/schema.prisma` (`EmailCampaign.responseMode`, `autoSendConfidenceThreshold`)
- Campaign UI: `components/dashboard/settings/ai-campaign-assignment.tsx`
- Auto-send call sites:
  - `lib/background-jobs/email-inbound-post-process.ts`
  - `lib/background-jobs/sms-inbound-post-process.ts`
  - `lib/background-jobs/smartlead-inbound-post-process.ts`
  - `lib/background-jobs/instantly-inbound-post-process.ts`
  - `app/api/webhooks/email/route.ts` (direct webhook path)
- Background job scheduler:
  - `prisma/schema.prisma` (`BackgroundJob`, `BackgroundJobType`, `runAt`)
  - `lib/background-jobs/enqueue.ts`
  - `lib/background-jobs/runner.ts`
  - Cron route: `app/api/cron/background-jobs/route.ts`

## Work

1. **Schema: store delay window on campaigns (seconds)**
   - UI will display minutes, but DB stores seconds.
   - Add min/max fields to `EmailCampaign`:

```prisma
model EmailCampaign {
  // ...existing fields...
  autoSendDelayMinSeconds Int @default(180) // 3 minutes
  autoSendDelayMaxSeconds Int @default(420) // 7 minutes
}
```

2. **UI: campaign-level delay editor**
   - In `components/dashboard/settings/ai-campaign-assignment.tsx` add a “Delay” column:
     - enabled only when `responseMode === "AI_AUTO_SEND"`
     - UX: input in **minutes** as a range (`min` / `max`) with helper text (“wait 3–7 minutes after reply before auto-send”)
     - The actual scheduled time is randomized to the second within the configured window (e.g., 3m05s, 4m37s).
     - save via existing campaign update action

3. **Server actions: persist delay**
   - Extend `actions/email-campaign-actions.ts` update logic to accept + return:
     - `autoSendDelayMinSeconds`
     - `autoSendDelayMaxSeconds`
   - Validation:
     - clamp to sane bounds: `0..3600` (0–60 minutes)
     - ensure `max >= min`

4. **Scheduling: enqueue an auto-send background job**
   - Add new `BackgroundJobType` value(s) for delayed auto-send (ex: `AI_AUTO_SEND_DELAY`).
   - Prefer reusing the existing `BackgroundJob.messageId` as the trigger inbound message ID.
   - Optional (only if needed): add `draftId` to `BackgroundJob` so the job can send the draft deterministically without a lookup:

```prisma
model BackgroundJob {
  // ...existing fields...
  draftId String?
  draft   AIDraft? @relation(fields: [draftId], references: [id], onDelete: SetNull)
}
```

   - Enqueue when evaluator allows auto-send (and delay window is non-zero):
     - Compute `randomizedDelaySeconds` within the configured campaign window.
     - If `randomizedDelaySeconds === 0`, keep current behavior (send immediately) to avoid cron/queue latency.
     - Otherwise:
       - `runAt = inboundMessage.sentAt + randomizedDelaySeconds`
       - `dedupeKey` includes `type` + `messageId` (and `draftId` if stored)
   - Update all existing auto-send call sites to schedule (instead of immediately send) when delay window is configured:
     - `app/api/webhooks/email/route.ts`
     - `lib/background-jobs/email-inbound-post-process.ts`
     - `lib/background-jobs/sms-inbound-post-process.ts`
     - `lib/background-jobs/smartlead-inbound-post-process.ts`
     - `lib/background-jobs/instantly-inbound-post-process.ts`
   - Randomization rule:
     - `randomizedDelaySeconds` is chosen uniformly within `[minSeconds, maxSeconds]` (inclusive), randomized to the second.
     - Prefer deterministic pseudo-randomness keyed by `messageId` (so retries compute the same `runAt`).
   - Cursor rule (pre-flight):
     - Before enqueuing, confirm the current inbound is the **active trigger inbound** (newest inbound across channels within the “latest inbound(s)” union). If not, skip enqueue.

5. **Runner: execute delayed send**
   - In `lib/background-jobs/runner.ts`, add handler for the new job type:
     - load job.draftId → fetch draft
     - skip if:
       - draft is no longer `pending`
       - the trigger inbound is no longer the active trigger inbound (newer inbound(s) exist; see cancellation rules)
       - lead/campaign no longer in AI auto-send mode
     - send via `approveAndSendDraftSystem(draftId, { sentBy: "ai" })`

6. **Cancellation rules (prevent stale sends)**
   - Global rule (apply across workflow):
     - Always prioritize the **newest inbound messages across all channels**.
     - Compute “latest inbound(s)” as the union of inbound messages after the latest outbound on each channel (supports “double” email/text).
     - Skip work (draft/eval/send) for older trigger inbounds that are no longer part of the active “latest inbound(s)” set at execution time.
   - Job execution checks (must all pass):
     - The trigger inbound message is still part of the active “latest inbound(s)” set (cross-channel).
     - No outbound message has been sent after the trigger inbound (any channel; manual setter sends cancel pending auto-send).
     - No newer inbound exists since the trigger inbound (cross-channel).
   - If any check fails → mark job as succeeded (skipped) with an audit log string explaining why.

7. **Telemetry + audit**
   - Log/record when a job is skipped due to newer inbound (so debugging is possible).
   - Ensure AIInteraction attribution remains correct (telemetry already captures promptKey/featureId).

## Validation (RED TEAM)

- Default delay window is `3–7 minutes` for AI auto-send campaigns (unless overridden).
- Setting delay to 0 keeps current behavior (immediate send).
- Setting delay to 120 seconds schedules a background job and sends after ~2 minutes.
- If the lead replies again (any channel) before the delay, the earlier scheduled auto-send is skipped.
- No duplicate sends when cron runs multiple times (dedupeKey + draft status checks).

## Output

**Completed:**

1. **Schema changes:**
   - Added `autoSendDelayMinSeconds Int @default(180)` to EmailCampaign
   - Added `autoSendDelayMaxSeconds Int @default(420)` to EmailCampaign
   - Added `AI_AUTO_SEND_DELAYED` to BackgroundJobType enum
   - Added `draftId String?` to BackgroundJob with AIDraft relation
   - Ran `npm run db:push` to apply changes

2. **Server actions (`actions/email-campaign-actions.ts`):**
   - Extended `EmailCampaignData` type to include delay fields
   - Updated `updateEmailCampaignConfig()` to accept/return delay settings
   - Added `clampDelaySeconds()` helper with bounds validation (0-3600s)

3. **Delayed auto-send scheduling (`lib/background-jobs/delayed-auto-send.ts`):**
   - `scheduleDelayedAutoSend()` — enqueues delayed job with deterministic runAt
   - `validateDelayedAutoSend()` — checks if safe to send (draft pending, no newer inbound/outbound)
   - `getCampaignDelayConfig()` — retrieves delay settings for a campaign
   - Uses deterministic pseudo-randomness (message ID hash) for stable retry behavior

4. **Job runner (`lib/background-jobs/runner.ts`):**
   - Added import for `runAiAutoSendDelayedJob`
   - Added `draftId` to locked job selection
   - Added case handler for `AI_AUTO_SEND_DELAYED` job type

5. **Runner handler (`lib/background-jobs/ai-auto-send-delayed.ts`):**
   - Validates draft is still pending
   - Checks for newer inbound/outbound messages (cancellation)
   - Verifies campaign is still in AI_AUTO_SEND mode
   - Sends via `approveAndSendDraftSystem(draftId, { sentBy: "ai" })`

6. **Updated auto-send call sites:**
   - `lib/background-jobs/smartlead-inbound-post-process.ts`
   - `lib/background-jobs/instantly-inbound-post-process.ts`
   - `lib/background-jobs/sms-inbound-post-process.ts`
   - `lib/background-jobs/email-inbound-post-process.ts`
   - All now check for delay config and schedule delayed jobs instead of immediate sends

7. **UI controls (`components/dashboard/settings/ai-campaign-assignment.tsx`):**
   - Added "Delay" column with min/max minute inputs
   - Shows delay range in minutes (stored as seconds)
   - Disabled when responseMode != AI_AUTO_SEND
   - Helper text shows delay status

**Verification:**
- `npm run lint` — passed
- `npm run build` — passed
- `npm run db:push` — applied

## Handoff

Return to Phase 47 verification checklist (`lint`, `build`, `db:push`) and smoke tests for:
- prompt edits affecting runtime
- stage-scoped booking templates affecting runtime
- delayed auto-send working end-to-end

## Review Notes

- Evidence: delayed sends are validated at execution time (`lib/background-jobs/delayed-auto-send.ts:validateDelayedAutoSend`), but the immediate-send path (delay window = 0) does not apply the same “newer inbound/outbound cancels send” checks.
- Impact: if a workspace configures `0` delay, auto-send can respond to a stale trigger under rapid multi-inbound conditions; see `docs/planning/phase-47/review.md`.
