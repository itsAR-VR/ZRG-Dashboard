# Phase 140b - Expand Programmatic Pricing Validation Functions + Source Precedence

## Focus

Update pricing safety functions in `lib/ai-drafts.ts` so enforcement is:
- source-aware (`serviceDescription` canonical, `knowledgeContext` fallback)
- cadence-aware (monthly/annual/quarterly semantics)
- still strict against unsupported amounts

## Inputs

- Subphase 140a completed
- `lib/ai-drafts.ts` pricing helpers and post-pass safety block
- `lib/__tests__/ai-drafts-pricing-placeholders.test.ts` current behavior baseline

## Work

1. Update `detectPricingHallucinations()` to:
   - consume `knowledgeContext` (no ignored arg)
   - apply source precedence rules
   - return cadence mismatch diagnostics in addition to unsupported amounts
2. Update `enforcePricingAmountSafety()` to:
   - accept `knowledgeContext`
   - enforce source precedence
   - remove or normalize unsupported cadence claims (for example, monthly-plan wording when canonical source is quarterly billing)
3. Replace cadence-biased clarifier text with cadence-safe clarifier wording.
4. Keep threshold exclusions (`$1M+`, raised, ARR) unchanged.
5. Validate with `npm run lint` and `npm run build`.

## Output

- Deterministic pricing safety functions enforce source precedence and cadence integrity
- Unsupported amount and unsupported cadence claims are caught before persistence
- Clarifier behavior remains safe when pricing context is missing/ambiguous

## Handoff

Subphase c updates callsites and expands test coverage for precedence + cadence edge cases.
