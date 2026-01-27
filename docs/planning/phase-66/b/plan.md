# Phase 66b — Remove Sentiment-Based Auto-Start for "Meeting Requested" (All Entrypoints)

## Focus
Remove the automatic triggering of the "Meeting Requested Day 1/2/5/7" sequence when sentiment changes to "Meeting Requested" (or otherwise becomes positive).

After this subphase, **no inbound processor** should be able to auto-start Meeting Requested; only the setter’s **first manual email reply** (Phase 66c) triggers it.

## Inputs
- Phase 66a completed: No Response auto-start disabled (without breaking outbound-touch scheduling)
- Current implementation: `autoStartMeetingRequestedSequenceIfEligible()` in `lib/followup-automation.ts`
- Known call sites (verify with `rg`):
  - `lib/inbound-post-process/pipeline.ts`
  - `app/api/webhooks/email/route.ts` (multiple)
  - `lib/background-jobs/sms-inbound-post-process.ts`
  - `lib/background-jobs/linkedin-inbound-post-process.ts`

## Work

### Step 1: Add a central safety disable (belt-and-suspenders)
In `lib/followup-automation.ts`, modify `autoStartMeetingRequestedSequenceIfEligible()` so it **never** starts a sequence and instead returns:
- `{ started: false, reason: "sentiment_autostart_disabled" }`

Keep the function signature for now so any missed call site is still safe.

### Step 2: Remove call sites from all inbound entrypoints (recommended)
Remove the Meeting Requested auto-start stage/call from each file:

**A) `lib/inbound-post-process/pipeline.ts`**
- Remove `pushStage("auto_start_meeting_requested")` + `await autoStartMeetingRequestedSequenceIfEligible(...)`.

**B) `app/api/webhooks/email/route.ts`**
- Remove all occurrences of `await autoStartMeetingRequestedSequenceIfEligible(...)`.

**C) `lib/background-jobs/sms-inbound-post-process.ts`**
- Remove `await autoStartMeetingRequestedSequenceIfEligible(...)`.

**D) `lib/background-jobs/linkedin-inbound-post-process.ts`**
- Remove `await autoStartMeetingRequestedSequenceIfEligible(...)`.

### Step 3: Verify no remaining call sites
Run:
```bash
rg -n "autoStartMeetingRequestedSequenceIfEligible" -S .
```

Confirm there are no remaining runtime calls (planning docs references are fine).

## Output
- Implemented in working tree (uncommitted):
  - `autoStartMeetingRequestedSequenceIfEligible()` is now a no-op backstop (`reason: "sentiment_autostart_disabled"`).
  - Removed runtime call sites from all inbound processors + email webhook.
  - `rg -n "autoStartMeetingRequestedSequenceIfEligible" -S .` shows only the function definition + planning-doc references.
- Evidence: `docs/planning/phase-66/review.md`

## Handoff
Phase 66c creates the new trigger function for **setter first email reply** and integrates it into `actions/email-actions.ts:sendEmailReplyInternal()`.
