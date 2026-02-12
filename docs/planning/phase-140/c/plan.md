# Phase 140c - Update Callsites + Cadence Test Coverage

## Focus

Wire updated pricing safety functions at callsites and expand tests to cover source precedence and cadence mismatch scenarios.

## Inputs

- Subphase 140b completed
- `lib/ai-drafts.ts` final draft post-pass callsites
- `lib/__tests__/ai-drafts-pricing-placeholders.test.ts`

## Work

1. Update `enforcePricingAmountSafety()` callsite in the email post-pass to pass `knowledgeContext`.
2. Confirm `detectPricingHallucinations()` callsite uses `knowledgeContext` and consumes cadence diagnostics.
3. Expand tests with explicit scenarios:
   - knowledgeContext-only pricing retained when service description is silent
   - service vs knowledge conflict resolves to service description
   - same amount but wrong cadence is flagged/removed
   - quarterly billing with monthly-equivalent wording is allowed only when billing cadence is explicit
   - no pricing in either source strips unsupported amount and adds clarifier
   - thresholds like `$1M+` remain untouched
4. Run:
   - `npm test -- lib/__tests__/ai-drafts-pricing-placeholders.test.ts`
   - `npm run lint`
   - `npm run build`

## Output

- Updated tests:
  - `lib/__tests__/ai-drafts-pricing-placeholders.test.ts` now covers:
    - knowledge-context fallback retention
    - service-description precedence on conflict
    - same-amount cadence mismatch detection/removal
    - quarterly-only monthly-plan normalization
    - cadence-safe clarifier behavior
  - `lib/__tests__/auto-send-evaluator-input.test.ts` now validates cadence-mismatch payload signals.
- Validation executed:
  - `npm test -- lib/__tests__/ai-drafts-pricing-placeholders.test.ts lib/__tests__/auto-send-evaluator-input.test.ts` — pass
  - `npm run lint` — pass (warnings only, pre-existing)
  - `npm run build` — pass
- Coordination note:
  - No edits were made to active scheduling/timezone files despite concurrent phase changes; only targeted pricing/evaluator test surfaces were touched.

## Handoff

Subphase d deploys, rebases Founders Club Step 3 override, and verifies runtime behavior.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added and updated precedence/cadence test matrix across pricing and evaluator-input tests.
  - Fixed cadence parsing edge case (`no monthly payment plan`) by excluding negated monthly signals.
- Commands run:
  - `npm test -- lib/__tests__/ai-drafts-pricing-placeholders.test.ts lib/__tests__/auto-send-evaluator-input.test.ts` — pass
  - `npm run lint` — pass (0 errors, warnings only)
  - `npm run build` — pass
- Blockers:
  - None in this subphase.
- Next concrete steps:
  - Attempt subphase d runtime rebase + verification against workspace override.
