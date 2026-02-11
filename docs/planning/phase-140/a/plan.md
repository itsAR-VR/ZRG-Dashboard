# Phase 140a - Expand Step 3 Verifier Prompt + Rebase Script

## Focus

Update `EMAIL_DRAFT_VERIFY_STEP3_SYSTEM` to enforce pricing with source precedence and cadence-safe wording:
- canonical first: `<service_description>`
- fallback: `<knowledge_context>` only when service description is silent
- explicit cadence handling including quarterly billing semantics

Then update the Founders Club Step 3 override rebase script to the same contract.

## Inputs

- `lib/ai/prompt-registry.ts` (`EMAIL_DRAFT_VERIFY_STEP3_SYSTEM`)
- `scripts/rebase-email-step3-pricing-override.ts`
- Root phase decision: `serviceDescription` is canonical source on conflict

## Work

1. Update Step 3 pricing rule text to include:
   - source precedence (`service_description` first, `knowledge_context` fallback when service description is silent)
   - cadence-aware validation (monthly, annual, quarterly)
   - explicit anti-drift language: do not imply a monthly payment plan when billing cadence is quarterly
   - clarifier path when no supported pricing/cadence exists
2. Update script replacement text to exactly match the new Step 3 rule.
3. Ensure script patch logic targets the active PRICING VALIDATION rule text (not legacy-only markers).
4. Validate with `npm run lint` and `npm run build`.

## Output

- Step 3 verifier default prompt updated to source precedence + cadence-safe contract
- Rebase script updated for the new Step 3 contract
- New `baseContentHash` expected (rebase required in subphase d)

## Handoff

Subphase b updates deterministic pricing safety functions to enforce the same source precedence and cadence rules.
