# Phase 180b — Fix Inbound Routing Suppression (email/SMS/LinkedIn + shared pipeline)

## Focus
Ensure inbound processors do **not** skip normal draft generation for Meeting Requested, and restrict any “intentional routing” suppression to Follow Up timing/sequence purposes only.

## Inputs
- Phase 180 root contract.
- Phase 180a findings (exact suppression trigger points + replay IDs).

## Work
1. Update routing suppression logic in:
   - `lib/background-jobs/email-inbound-post-process.ts`
   - `lib/background-jobs/sms-inbound-post-process.ts`
   - `lib/background-jobs/linkedin-inbound-post-process.ts`
   - `lib/inbound-post-process/pipeline.ts`

2. Behavioral changes (decision-locked):
   - Remove `autoBook.context.followUpTaskCreated` as a reason to suppress inbound draft generation.
   - Meeting Requested must always proceed to `generateResponseDraft(...)` (unless auto-booked / compliance blocked).
   - Keep suppression only for Follow Up timing/sequence paths (as confirmed in 180a):
     - If suppression is still needed, gate it explicitly on `sentimentTag === "Follow Up"` and a known follow-up timing/sequence condition (not “any follow-up task exists”).

3. Slack “Intentional Routing” alert:
   - Ensure `⚠️ AI Draft Routed (Intentional Routing)` is not emitted for Meeting Requested.
   - If the alert remains useful for Follow Up, scope it to that sentiment only (or remove entirely if it is no longer actionable).

4. Safety checks:
   - Confirm compliance blocks (opt-out/bounce/blacklist) still prevent drafting/sending as before.
   - Confirm we still skip drafting when `autoBook.booked === true` (booking confirmation path).

## Output
- Meeting Requested inbound messages no longer get suppressed drafting due to any follow-up-task creation side effects.
- Draft generation suppression is now narrowly scoped to Follow Up timing/sequence only.

## Handoff
Proceed to Phase 180c to remove booking followup_task drafts and harden Call Requested auto-send skip + backfill scope.

## Progress This Turn (2026-02-21)
- Implemented suppression hardening in:
  - `lib/background-jobs/email-inbound-post-process.ts`
  - `lib/background-jobs/sms-inbound-post-process.ts`
  - `lib/background-jobs/linkedin-inbound-post-process.ts`
  - `lib/inbound-post-process/pipeline.ts`
- `schedulingHandled` is now tied to explicit Follow Up timing routing only:
  - `shouldAttemptFollowUpRouting = sentimentTag/newSentiment === "Follow Up" && timingFollowUpScheduled`
  - suppression proceeds only when `hasPendingEligibleFollowUpTaskDraft(...) === true`
- Meeting Requested no longer inherits suppression from broad task-creation side effects.
- Process 5 protection in inbound draft suppression path was preserved by guarding call-requested no-phone suppression with `actionSignals.route?.processId !== 5`.

## Conflict Log
- Issue: Shared inbound processors are concurrently modified across phases 176/177/178/179.
- Overlap phase(s): 176, 177, 178, 179.
- File(s): `lib/background-jobs/email-inbound-post-process.ts`, `lib/background-jobs/sms-inbound-post-process.ts`, `lib/background-jobs/linkedin-inbound-post-process.ts`, `lib/inbound-post-process/pipeline.ts`.
- Resolution: Kept existing booking-process router integrations and narrowed only suppression predicates + routed-draft eligibility checks; no sequencing changes to webhook/post-process flow.
- Residual risk: If future phases broaden `timingFollowUpScheduled` semantics, Follow Up suppression could expand unintentionally unless guarded by eligibility helper tests.
