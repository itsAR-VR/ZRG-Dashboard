# Phase 105b — Follow-Up Draft Idempotency

## Focus
Ensure the follow-up email step is idempotent per `(instanceId, stepOrder)` and does not spawn duplicate drafts/tasks under re-entrant cron execution.

## Inputs
- `lib/followup-engine.ts` (follow-up processing)
- `prisma/schema.prisma` (`AIDraft @@unique([triggerMessageId, channel])`)
- Outputs from Phase 105a (evidence + root cause)

## Work
- Use a deterministic draft key for follow-up email steps (e.g., `followup:<instanceId>:<stepOrder>`).
- Prevent duplicate `FollowUpTask` creation for the same step by checking existing tasks before creating.
- Ensure idempotency does not interfere with booking-stop or other follow-up flows.

## Output
- Follow-up email step is idempotent and safe under overlap.
- Deterministic draft key (`followup:<instanceId>:<stepOrder>`) and task dedupe added in `lib/followup-engine.ts`.

## Handoff
Proceed to 105c for single-flight send + failure semantics.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented deterministic draft key for follow-up email steps.
  - Added draft/task dedupe checks for pending/completed follow-up tasks.
  - Guarded against follow-up draft key collisions.
- Commands run:
  - None.
- Blockers:
  - None.
- Next concrete steps:
  - Implement single-flight send + safe failure semantics (Phase 105c).
