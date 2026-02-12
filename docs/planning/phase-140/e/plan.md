# Phase 140e - Cadence Guardrails in Evaluator + Observability

## Focus

Add deterministic and model-level safeguards so pricing cadence mismatches (monthly vs annual vs quarterly) are caught even when amount values are technically valid.

## Inputs

- Subphases 140a-140d completed (prompt, safety layer, tests, override rebase)
- `lib/auto-send-evaluator-input.ts`
- `lib/auto-send-evaluator.ts`
- `lib/ai/prompt-registry.ts` (`AUTO_SEND_EVALUATOR_SYSTEM`)
- `lib/ai-drafts.ts` final artifact payload + pricing warning path

## Work

1. **Add cadence extraction signals into auto-send evaluator input**
   - Add derived fields to evaluator payload:
     - `pricing_terms_verified`
     - `pricing_terms_draft`
     - `pricing_terms_mismatch`
   - Extraction should be conservative and deterministic (mark unknown when uncertain).

2. **Update evaluator system rule for cadence mismatch**
   - Extend `AUTO_SEND_EVALUATOR_SYSTEM` to require human review when draft cadence conflicts with verified workspace pricing semantics.
   - Keep existing opt-out/blacklist/automated hard blocks unchanged.

3. **Add cadence observability in draft pipeline**
   - Persist cadence signal in final draft artifact payload.
   - Emit warning telemetry signal (parallel to pricing hallucination warning) when cadence mismatch is detected.

4. **Validation**
   - Add/extend unit tests for evaluator input cadence extraction and mismatch flags.
   - Run `npm run lint` and `npm run build`.

## Output

- Updated evaluator input payload in `lib/auto-send-evaluator-input.ts`:
  - Added `pricing_terms_verified`, `pricing_terms_draft`, and `pricing_terms_mismatch`.
  - Added deterministic cadence extraction + mismatch resolution (`service_description` precedence).
  - Extended stats with `pricingCadence` summary.
- Updated evaluator policy in `lib/ai/prompt-registry.ts`:
  - Added hard-block rule for pricing cadence conflicts with verified context.
- Updated tests:
  - `lib/__tests__/auto-send-evaluator-input.test.ts` validates cadence mismatch signal path.
- Coordination note:
  - Subphase implemented without modifying concurrent scheduling/timezone logic files.

## Handoff

Return to root phase closeout and confirm runtime behavior in at least one quarterly-billing workspace case.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented evaluator-side cadence mismatch extraction/signaling.
  - Added evaluator system-rule hard blocker for cadence mismatch.
  - Added unit coverage for mismatch detection.
- Commands run:
  - `npm test -- lib/__tests__/auto-send-evaluator-input.test.ts` (via targeted test run command) — pass
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass
- Blockers:
  - None in this subphase.
- Next concrete steps:
  - Complete subphase d runtime rebase + live validation once env access is available.
