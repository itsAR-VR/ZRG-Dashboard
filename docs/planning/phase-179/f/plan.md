# Phase 179f — Fix: Follow-Up Timing Due Processor Reliability + Attempt #2 Link Policy

## Focus
Fix the “Slack fired but no auto-send” follow-up-timing clarifier reliability failures while matching Phase 179 policy:
- Attempt #1: timeframe question only (no links).
- Attempt #2: includes the workspace booking link.

## Inputs
- Phase 175 clarifier behavior and policies.
- Due-task processor: `lib/followup-timing.ts` (`processScheduledTimingFollowUpTasksDue`).
- Attempt #2 creation path: `actions/message-actions.ts` (`maybeHandleTimingClarifyFollowUpAutomation`, `generateTimingClarifyNudge`).

## Work
1. Fix “recent conversation activity” self-blocking (grace-window behavior)
   - In `lib/followup-timing.ts` (`processScheduledTimingFollowUpTasksDue`), replace the current block:
     - “any Message with `sentAt > task.createdAt`” ⇒ converts to manual
   - New rule: only convert to manual when there is meaningful conversation activity after task creation:
     - inbound message after `task.createdAt`, OR
     - outbound message after `task.createdAt` where `sentBy = 'setter'`.
   - Ignore system/backfill/AI activity (`sentBy IS NULL` or `sentBy = 'ai'`) so post-process work doesn’t self-block.
2. Enforce campaign gating for follow-up-task auto-send
   - In `processScheduledTimingFollowUpTasksDue`, require `lead.emailCampaign.responseMode === 'AI_AUTO_SEND'` before auto-sending any follow-up tasks (including timing clarifiers).
3. Timing clarifier link policy (Attempt #2 only)
   - Keep Attempt #1 (`lib/followup-timing.ts` `generateFollowUpTimingClarification`) link-free.
   - Update Attempt #2 generation in `actions/message-actions.ts`:
     - Resolve workspace booking link for the lead’s client.
     - Pass booking link into `generateTimingClarifyNudge` (new param) and update its prompt rules to require including that link.
     - Ensure deterministic fallback appends the booking link when AI nudge fails.
4. Regression coverage
   - Add unit tests verifying:
     - post-process/backfill messages do not block follow-up-task auto-send
     - a new inbound reply after task creation does block/convert to manual
     - Attempt #2 includes the booking link; Attempt #1 does not

## Output
- Due-task processor no longer self-blocks on post-process activity.
- Timing clarifier Attempt #2 includes booking link; Attempt #1 remains timeframe-only.

## Handoff
Phase 179d (or a new closeout subphase if needed) runs the manifest-driven NTTAN gates and records replay artifact outcomes.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Updated follow-up timing due-task sender to:
    - require `lead.emailCampaign.responseMode === "AI_AUTO_SEND"` before auto-sending,
    - ignore post-process/AI activity when deciding “recent conversation activity” (only inbound or setter outbound blocks auto-send).
  - Implemented Attempt #2 booking link policy:
    - Attempt #2 generation now resolves the workspace booking link and ensures it is included (AI nudge if available; deterministic append fallback).
  - Increased follow-up timing extraction retry budget by 3x to reduce `max_output_tokens` truncation failures.
- Commands run:
  - `sed`/`rg` reads of `lib/followup-timing.ts`, `actions/message-actions.ts`, `lib/followup-timing-extractor.ts` to confirm current gates and prompt budgets before patching.
- Blockers:
  - None yet (tests/NTTAN not run in this subphase).
- Next concrete steps:
  - Add/adjust unit tests for:
    - meaningful-activity gate behavior
    - Attempt #2 includes booking link; Attempt #1 does not
  - Run Phase 179d validation gates on the Phase 179 replay manifest.
