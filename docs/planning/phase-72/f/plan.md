# Phase 72f — Follow-Up Sequence Enhancement

## Focus

Ensure follow-up emails use the same smart TO/CC swap logic as manual replies:

- If a CC’d person becomes the active replier, follow-up emails should go **TO the current replier** and **CC the original lead**.

## Inputs

- Phase 72a: Lead has `currentReplierEmail`, `currentReplierSince`
- Phase 72e: Smart recipient resolution in `lib/email-send.ts` swaps TO/CC based on the latest inbound sender and persisted lead fields.
- `lib/followup-engine.ts` executes follow-ups via `sendEmailReply(draft.id)` (reply-only infrastructure).

## Work

### 1. Confirm follow-ups route through `lib/email-send.ts`

- In `lib/followup-engine.ts`, confirm the email follow-up path continues to send via `sendEmailReply(draft.id)` (no direct “new outbound email” path).
- Avoid adding a CC override from follow-up-engine unless strictly necessary (overrides can accidentally drop existing CCs inherited from the thread).

### 2. Optional: add lightweight logging for effective recipients

After `sendEmailReply(draft.id)` returns success, optionally load the created outbound `Message` row and log `toEmail` + `cc[]` for debugging.

### 3. Validation (RED TEAM)

- Manual test (EmailBison / SmartLead / Instantly):
  1) Lead primary email (Max) receives an email thread and CCs Teddy.
  2) Teddy replies (inbound sender differs from `Lead.email`).
  3) Run/trigger a follow-up email step.
  4) Confirm follow-up sends **TO Teddy** and **CC Max**, and stays in the same thread.

## Output

- Verified follow-ups already send via `sendEmailReply(draft.id)` and therefore inherit the Phase 72 recipient swap logic in `lib/email-send.ts`.
- No follow-up engine code changes required; avoided CC overrides to preserve thread CC context.

## Handoff

Follow-ups now route to the correct participant via shared email-send logic. Phase 72g implements admin-only promotion + setter request flow.
