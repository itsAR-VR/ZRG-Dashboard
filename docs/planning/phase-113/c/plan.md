# Phase 113c — One-Retry Loop + Slack Escalation + Regression Tests

## Focus
Implement a bounded safety loop around booking gate uncertainty:
- If booking gate returns `needs_clarification`, **retry once** with richer structured context.
- If still not `approve` (or model fails), **do not auto-book**:
  - create a `FollowUpTask` (human-routed)
  - send a Slack alert (no raw message text)

Add regression coverage for:
- day-only slot selection
- gate call conditions and retry behavior
- idempotent persistence (`messageId_stage`)

## Inputs
- Booking gate:
  - `runFollowupBookingGate(...)` in `lib/followup-engine.ts`
  - `followup.booking.gate.v1` in `lib/ai/prompt-registry.ts`
- Slack notifications:
  - `sendSlackNotification` usage patterns in `lib/followup-engine.ts`
- Existing tests harness:
  - `scripts/test-orchestrator.ts`

## Work
1. Implement retry-on-`needs_clarification`
   - Retry exactly once, and include more structured context on retry:
     - offered slots ledger (full list, capped)
     - selected/accepted slot (if any)
     - candidate slots list (for day-only)
     - overseer extraction summary fields
   - Add `retryCount` to stats-only metadata (`AIInteraction.metadata.bookingGate.retryCount`).

2. “Still unclear” fallback path
   - If post-retry decision is not `approve` (or the model errors/times out):
     - create `FollowUpTask` with a suggested message if appropriate (or a generic “needs human booking review” message)
     - send Slack alert including:
       - leadId, workspace name, scenario, gate decision, confidence, issuesCount
     - do not book

3. Tests
   - Add unit tests for day-only slot selection helper (timezone-sensitive).
   - Add tests for:
     - gate runs in Scenario 1/2 when enabled
     - retry runs at most once
     - idempotent gate persistence keyed by `messageId_stage`

## Validation
- `npm test` passes, including new tests.
- `npm run build` passes.

## Output

- Booking gate now retries exactly once on `needs_clarification` (Scenario 1/2 accept-offered, Scenario 3 proposed-time match, Scenario 3 day-only).
- If the gate still returns `needs_clarification` after retry, or the gate call fails, the system:
  - creates a human-routed `FollowUpTask` (no auto-book)
  - sends a Slack alert (no raw message text)
- Added unit coverage for the bounded retry helper.

## Handoff
After merge, staged rollout:
1. Enable booking gate for 1 internal workspace.
2. Validate accept-offered and day-only flows with real inbound threads.
3. Expand rollout gradually.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented one-retry loop for booking gate `needs_clarification` with a richer structured retry context (file: `lib/followup-engine.ts`).
  - Added Slack alert path for “blocked after retry” and “gate failed” outcomes (no raw message text) (file: `lib/followup-engine.ts`).
  - Added unit tests for retry behavior (files: `lib/__tests__/followup-booking-gate-retry.test.ts`, `scripts/test-orchestrator.ts`).
- Commands run:
  - `npm test` — pass
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass
- Blockers:
  - None
- Next concrete steps:
  - Write Phase 113 review (`docs/planning/phase-113/review.md`) with evidence mapping to success criteria.
