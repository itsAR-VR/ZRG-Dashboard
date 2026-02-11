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

- Email post-pass passes both pricing sources to safety enforcement
- Tests capture precedence and cadence edge cases and prevent regressions

## Handoff

Subphase d deploys, rebases Founders Club Step 3 override, and verifies runtime behavior.
