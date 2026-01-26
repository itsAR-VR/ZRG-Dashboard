# Phase 56d — Highest-Risk Missing Unit Tests

## Focus
Add focused unit tests for the newest, highest-risk primitives so future refactors and rollouts have guardrails.

## Inputs
- Phase 55: `lib/emailbison-first-touch-availability.ts`
- Phase 51: `lib/inbound-post-process/pipeline.ts`
- Existing test patterns under `lib/__tests__` and `lib/**/__tests__`

## Work
1) **Phase 55 processor tests**
   - Add unit tests for `processEmailBisonFirstTouchAvailabilitySlots()` using dependency injection or lightweight fakes for:
     - “due within 15m” gating
     - idempotency skip behavior (availability already set + offeredSlots recent)
     - “preserve other custom vars” behavior (upsert logic)

2) **Phase 51 inbound kernel ordering/invariants**
   - Add a unit test that asserts the expected stage order and that cancellation/early-exit doesn’t skip required invariants (as feasible without provider calls).

3) **(Optional) Notification Center rules**
   - If time permits, add a small rules-normalization + dedupe test (Phase 52 follow-up).

## Output
- New test files + a short note about what the tests cover and what remains untested.

## Handoff
If tests reveal gaps or non-determinism, propose the smallest refactor to make the code more testable (new phase if needed).

