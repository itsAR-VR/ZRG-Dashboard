# Phase 64f — Hardening: Tests + Rollout Notes

## Focus
Reduce regression risk for outbound booking links by adding targeted unit coverage and documenting rollout/rollback, so “AI drafts send the wrong/stale booking link” cannot silently return.

## Inputs
- Phase 64b: outbound booking link semantics (Link A + null behavior)
- Phase 64c: AI draft enforcement changes
- Existing test harness: `npm test` runs `scripts/test-orchestrator.ts` (fixed list)
- Canonicalization helper: `lib/ai-drafts/step3-verifier.ts:enforceCanonicalBookingLink()`

## Work

### Step 1: Add unit tests
Add a focused `node:test` suite under `lib/__tests__/` to cover:
- When `bookingLink` is provided, canonicalization enforces that link (covers the observed stale-link pattern).
- When `bookingLink` is `null`, we strip known booking-link URLs (Calendly/GHL/HubSpot patterns) from drafts.
- When Calendly has a branded/public override, outbound resolution returns the branded link (and enforcement replaces raw `calendly.com` links).

Update `scripts/test-orchestrator.ts` to include the new test file in `TEST_FILES`.

### Step 2: Rollout + rollback notes
- Rollout:
  - Deploy with Link A configured for a single client; verify outbound drafts show the expected link.
- Rollback:
  - If link behavior regresses, revert the code change and/or clear Link A to force “no booking link configured” behavior.

## Validation (RED TEAM)
- `npm test`
- `npm run lint`
- `npm run build`

## Output
- Regression tests added and executed via `npm test`
- Clear rollout/rollback steps documented for safe production change management

## Handoff
Update `docs/planning/phase-64/plan.md` with Phase Summary + verification evidence after implementation and validation.
