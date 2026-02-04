# Phase 105c — Single-Flight Send + Safe Failure Semantics

## Focus
Prevent duplicate external sends by enforcing single-flight draft sending and safer post-send failure handling.

## Inputs
- `actions/email-actions.ts` (server action wrapper)
- `lib/email-send.ts` (system send)
- `actions/message-actions.ts` (shared send result typing)
- Outputs from Phase 105b

## Work
- Claim drafts atomically (`pending -> sending`) to enforce single-flight.
- If already sending, return a specific error code without retrying.
- If provider send likely succeeded but persistence fails, mark outcome as uncertain and **do not** revert to pending.
- Update shared error typing to include new error codes.

## Output
- At-most-once send behavior is preserved under concurrency and partial failures.
- Draft send flow enforces `pending -> sending` claim and `send_outcome_unknown` handling in `actions/email-actions.ts` + `lib/email-send.ts`.

## Handoff
Proceed to 105d for validation + rollout/monitoring notes.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added single-flight claim for email draft sends in server/system paths.
  - Added error codes for `draft_already_sending` and `send_outcome_unknown`.
  - Ensured uncertain outcomes pause follow-ups instead of re-sending.
- Commands run:
  - None.
- Blockers:
  - None.
- Next concrete steps:
  - Run quality gates and document validation/rollout notes (Phase 105d).
