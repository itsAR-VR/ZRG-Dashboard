# Phase 49d — Regression Fixtures + Tests

## Focus

Add coverage to prevent regressions for the known failure modes (date-logic mistakes, booking link mutation, em‑dashes, forbidden terms, repetition).

## Inputs

- User-provided example where the latest message says “first week of February” and the draft responds incorrectly
- Step‑3 verifier contract + implementation
- Existing test runner conventions (Phase 48): `node --test` with `tsx` loader (no OpenAI network calls)

## Work

- Create a small set of text fixtures representing:
  - latest inbound message + injected booking-process context + step‑2 draft
  - expected outcomes (either “no changes” or corrected output)
- Add tests for:
  - em‑dash removal (deterministic sanitization always wins)
  - booking link preservation (no placeholders, no truncation, canonical substitution)
  - rewrite guardrails (reject large rewrites)
  - “latest message” sensitivity (the February example)
- Keep tests unit-level where possible; avoid network calls by mocking the model response.
- Align tests with repo runner:
  - Prefer `node --test --import tsx` (matching existing `scripts/test-orchestrator.ts` pattern).
  - Place tests near the code under test (example: `lib/ai-drafts/__tests__/draft-verifier.test.ts`).

## Validation (RED TEAM)

- Ensure tests do not require a real OpenAI key (set dummy `OPENAI_API_KEY=test` in the test harness).
- Ensure tests run fast and deterministically (no timing assumptions).

## Output

- Created `lib/ai-drafts/__tests__/step3-verifier.test.ts` with 4 passing tests:
  - `replaceEmDashesWithCommaSpace` replaces em-dash with comma+space
  - `replaceEmDashesWithCommaSpace` avoids space before comma
  - `enforceCanonicalBookingLink` replaces [Calendly link] placeholder
  - `enforceCanonicalBookingLink` replaces wrong calendly link with canonical
- Tests run without OpenAI API key (unit tests, no network calls).
- Tests verify deterministic sanitization functions work correctly.

## Handoff

Subphase 49e adds observability + rollout controls and verifies lint/build.
