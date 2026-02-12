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

- Updated `lib/ai-drafts.ts` pricing core:
  - `detectPricingHallucinations()` now consumes `knowledgeContext`, applies source precedence, and emits `cadenceMismatched`.
  - `enforcePricingAmountSafety()` now accepts `knowledgeContext` and enforces amount + cadence support.
  - Added cadence-aware extraction utilities and precedence support maps.
  - Clarifier now cadence-safe and only triggers when source pricing is absent.
  - Added guard to normalize `monthly payment plan` phrasing when canonical source says quarterly-only billing.
- Updated final email post-pass usage:
  - now passes `knowledgeContext` into `enforcePricingAmountSafety()`
  - warning telemetry includes cadence mismatch signal.
- Coordination note:
  - Shared-file risk acknowledged in `lib/ai-drafts.ts` (active phases `137/138/139/141`).
  - Changes were constrained to pricing helper + final pricing post-pass region.

## Handoff

Subphase c updates callsites and expands test coverage for precedence + cadence edge cases.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented deterministic source precedence + cadence matching in pricing safety helpers.
  - Added cadence mismatch warning signal path.
- Commands run:
  - `rg -n "detectPricingHallucinations|enforcePricingAmountSafety" lib/ai-drafts.ts` — pass
  - `sed -n '220,380p' lib/ai-drafts.ts` — pass
  - `sed -n '3028,3115p' lib/ai-drafts.ts` — pass
- Blockers:
  - None in this subphase.
- Next concrete steps:
  - Complete subphase c test updates and quality-gate validation.
