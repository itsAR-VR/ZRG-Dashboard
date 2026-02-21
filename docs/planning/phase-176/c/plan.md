# Phase 176c — Follow-Up Timing Clarifier + Objection Routing + “No Draft” Fix

## Focus
Eliminate the “manual dead end” behavior by ensuring:
1) deferrals with no concrete date generate an ask-for-date draft, and
2) meeting requested flows do not skip draft generation just because a task was created,
while routing objections away from the follow-up-timing clarify loop.

## Inputs
* Phase 176a: root-cause mapping.
* Phase 176b: meeting scheduler policy enforcement.

## Work
1. Follow-up timing clarify:
   - Ensure no-date deferrals create a draft that asks for a concrete date/time.
   - Hybrid channel policy:
     - SMS: deterministic ask-for-date copy.
     - Email/LinkedIn: AI-drafted ask-for-date copy (re-engagement style).
   - Likely touch points:
     - `lib/followup-timing.ts` / `lib/followup-timing-extractor.ts`
     - `lib/background-jobs/email-inbound-post-process.ts`
     - `lib/background-jobs/sms-inbound-post-process.ts`
     - `lib/background-jobs/linkedin-inbound-post-process.ts`
2. Objection routing:
   - Detect competitor/“already have X” and route to objection handling (do not create no-date follow-up clarify tasks/drafts).
   - Likely touch points:
     - `lib/sentiment.ts` (if sentiment classification can separate objection vs follow-up)
     - or new structured router co-located with `lib/followup-timing.ts`
3. “AI Draft Skipped” removal:
   - If scheduling flow creates a FollowUpTask, still create an AIDraft (or reuse `suggestedMessage` as a first-class draft) so inbox UI always has an actionable draft.
   - Likely touch points:
     - `lib/followup-engine.ts` (ensure every scheduling-created FollowUpTask also creates/upserts an `AIDraft` with `triggerMessageId = followup_task:<taskId>`)
     - `lib/background-jobs/*-inbound-post-process.ts` and `lib/inbound-post-process/pipeline.ts` (do not skip normal drafting unless the scheduling task has a draft, or schedule a backfill/repair)
     - Add a small repair/backfill function for existing pending tasks created before this fix.

## Output
## Changes (implemented)
1. Objection routing (email sentiment analysis):
   - Allowed `Objection` in the structured-output schema and validate allowlist (previously impossible to emit).
   - Reordered decision-rule priority so `Objection` beats `Follow Up` when both signals are present (e.g., “we already use X… maybe in the future”).
   - Files:
     - `lib/sentiment.ts`

2. “No Draft” fix for intentional scheduling routing:
   - Added a FollowUpTask → AIDraft backfill helper for pending messageable tasks (`email|sms|linkedin`) missing `AIDraft` rows.
   - Wired backfill + safety fallback into all inbound processors:
     - when `schedulingHandled=true`, we backfill drafts and only skip normal drafting if a pending `followup_task:*` draft exists; otherwise we fall back to `generateResponseDraft(...)` to avoid dead ends.
   - Added global backfill to background maintenance so existing production tasks are repaired without manual intervention.
   - Files:
     - `lib/followup-task-drafts.ts`
     - `lib/background-jobs/email-inbound-post-process.ts`
     - `lib/background-jobs/sms-inbound-post-process.ts`
     - `lib/background-jobs/linkedin-inbound-post-process.ts`
     - `lib/inbound-post-process/pipeline.ts`
     - `lib/background-jobs/maintenance.ts`

## Handoff
Proceed to Phase 176d:
1) add unit tests + replay manifest cases (Caleb + Jeff + Terra + Lee + Sanjit IDs from 176a),
2) run NTTAN gates and capture artifacts/evidence,
3) write `docs/planning/phase-176/review.md`,
4) commit + push.
