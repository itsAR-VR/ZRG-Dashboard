# Phase 177c — Implement Routing Eligibility Fixes (Interested + other sentiments) for Process 4/5

## Focus
Ensure Booking Process 4/5 route outcomes (especially Process 5 for Interested leads) reliably emit notifications, and verify routing is invoked for the required sentiments/channels.

## Inputs
- Phase 177a: FC message IDs + observed outcomes.
- Phase 177b: identified router invocation point(s) + current gating.

## Work
- Implement a booking-process notification event for `processId in {4,5}` (Phase 177a indicates Process 5 currently emits no `NotificationEvent`):
  - Persist a `NotificationEvent` row (either a new `kind` like `booking_process`, or encode process in the `dedupeKey` without schema changes).
  - Ensure idempotency: dedupe must include `clientId + leadId + messageId + processId` because routing can run multiple times.
- Verify (and only if needed) expand booking-process router invocation eligibility so Interested leads and any other required sentiments invoke routing.
- Keep changes minimal:
  - do not run routing on every inbound message unless Phase 177b proves it’s required.
  - preserve existing safety/opt-out gates.

## Output
- Code changes implementing booking-process notifications for Process 4/5 (and routing eligibility changes only if needed).
- Notes on behavior change boundaries and dedupe rules.

## Handoff
Phase 177d will address the soft-call vs callback ambiguity to prevent false Call Requested/Process 4 behavior.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added Notion scheduler-link extraction support so lead-provided Notion calendar links are treated as scheduler links:
    - `lib/scheduling-link.ts`
  - Made lead scheduler-link handling explicit-intent based (not sentiment-gated) and able to infer/persist the link from the inbound text:
    - `lib/lead-scheduler-link.ts`
  - Allowed call tasks to be created when Process 4/callback intent is detected under other sentiments (while keeping the existing sentiment-driven behavior):
    - `lib/call-requested.ts` (added `force` option)
    - Updated call sites to call after action-signal detection with `force: actionSignalCallRequested`:
      - `lib/inbound-post-process/pipeline.ts`
      - `lib/background-jobs/email-inbound-post-process.ts`
      - `lib/background-jobs/sms-inbound-post-process.ts`
      - `lib/background-jobs/linkedin-inbound-post-process.ts`
  - Tightened scheduler-link task triggering inputs to use reply-only text when available (reduces quoted-thread false positives):
    - `lib/background-jobs/email-inbound-post-process.ts`
    - `lib/inbound-post-process/pipeline.ts`
- Commands run:
  - None (code edits only).
- Blockers:
  - None.
- Next concrete steps:
  - Update AI prompts to prevent “soft call” language from being treated as callback/call-request (Phase 177d).
  - Add tests for Notion link extraction + explicit-instruction gating behavior (Phase 177e).
