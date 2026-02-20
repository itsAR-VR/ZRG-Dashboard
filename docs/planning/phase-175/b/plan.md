# Phase 175b — Clarifier Attempt Tracking + Throttling

## Focus
Prevent spam and “looping” clarification behavior by limiting timing-clarification pings and enforcing spacing between attempts.

## Inputs
* Phase 175a flag behavior and campaign naming conventions
* Current follow-up task model and existing dedupe/upsert logic
* Current “cancel pending clarification tasks when a concrete date is later detected” behavior in `lib/followup-timing.ts`

## Work
1. Lock the attempt policy (already decided):
* Max attempts: 2.
* Attempt #2 is created after any successful send of attempt #1 (auto-send or manual-approval path) and is due 24 hours later.
* Any inbound reply cancels attempt #2.
* Both attempts are expected to auto-send when flags + schedule permit; this does not bypass existing auto-send gates.
2. Encode attempt number in `FollowUpTask.campaignName`:
* `Follow-up timing clarification (auto) #1`
* `Follow-up timing clarification (manual) #1`
* `Follow-up timing clarification (auto) #2`
* `Follow-up timing clarification (manual) #2`
3. Update the inbound scheduler in `lib/followup-timing.ts`:
* For no-concrete-date inbound deferrals, create or update only attempt `#1`.
* Dedupe behavior:
  * If a pending attempt `#1` exists, update it with the newest suggested message and keep it pending.
  * Do not create attempt `#2` from inbound processing.
4. Create attempt `#2` only after attempt `#1` is sent:
* Hook into the post-send success path in `actions/message-actions.ts`:
  * When a draft with `triggerMessageId = followup_task:<taskId>` is sent successfully, look up the linked FollowUpTask.
  * If the task is a timing-clarifier `#1`, create a new timing-clarifier `#2` FollowUpTask with:
    * `dueDate = sentAt + 24 hours`
    * `status = pending`
    * `suggestedMessage` as a short nudge asking for a month/quarter (current implementation is deterministic; optional future improvement: generate via `followup.timing_clarify.v1`)
    * an immediate `AIDraft` with `triggerMessageId = followup_task:<taskId2>`
* Ensure attempt #2 is not created if:
  * a timing-clarifier `#2` already exists (pending or completed), or
  * any inbound reply exists after the attempt #1 send time.
5. Cancel attempt `#2` on any inbound reply:
* In inbound pipelines (`lib/inbound-post-process/pipeline.ts` and background job equivalents), after the inbound message is persisted:
  * cancel any pending timing-clarifier `#2` tasks for the lead, and
  * reject their pending drafts (`AIDraft.status = rejected`).
6. Remove clarify snoozing:
* Update `lib/followup-timing.ts` so timing-clarifier creation does not:
  * update `lead.snoozedUntil`, and
  * call `pauseFollowUpsUntil(...)`.
* The only pause behavior remains `pauseFollowUpsOnReply(...)` on inbound.
7. Exhaustion behavior after attempt #2 is sent with no reply:
* If attempt #2 is sent and there is still no inbound reply after it (check message table), switch to the “Re-engagement Follow-up” sequence.
* Implementation rule:
  * Only enroll if the lead does not already have that sequence instance completed.
  * If the sequence is missing or not active for the workspace, create a manual FollowUpTask instructing a human to enable/create and enroll.
* Safety default for enrollment timing:
  * Enroll with a delayed anchor so the sequence does not send immediately after attempt #2.
  * Default delay: 7 days after attempt #2 send (hardcoded constant in this phase unless we add a config flag).
8. Preserve existing behavior where a concrete follow-up date later detected cancels all pending clarify tasks and rejects their drafts.

## Output
* Timing-clarification attempts are bounded, throttled, and do not accumulate stale tasks/drafts.
* Clarifier flow no longer snoozes sequences via `lead.snoozedUntil`.
* Attempt #2 is reliably cancelled on any inbound reply.
* After exhaustion, the lead transitions into “Re-engagement Follow-up” (or gets a manual task if the sequence is unavailable).

## Progress This Turn (Terminus Maximus)
- Work done:
  - Wired `cancelPendingTimingClarifyAttempt2OnInbound({ leadId })` into all inbound post-process entry points so *any* inbound reply cancels pending timing-clarifier attempt `#2` tasks and rejects their pending drafts.
  - Hardened timing-clarifier attempt `#1` task upsert to avoid rare `update(...)` throws (uses `updateMany(...)` + fallback create) so “no_concrete_date_detected” no longer becomes a Slack miss when the pending task row is stale.
  - Applied copy policy decision: attempt `#2` now uses hybrid generation (`sms` deterministic nudge; `email`/`linkedin` generated via `followup.timing_clarify.v1` with deterministic fallback).
- Commands run:
  - Not run in this environment (per agent constraints; user did not request validation commands).
- Blockers:
  - None.
- Next concrete steps:
  - Implement the Not Interested soft-deferral gate (Phase 175c) so “not now / maybe later” replies that were labeled Not Interested still get the clarify flow.

## Handoff
Proceed to Phase 175c to ensure Not Interested cases are gated (soft deferral allowed, hard-no blocked).
