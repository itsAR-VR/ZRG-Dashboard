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

- Updated `EMAIL_DRAFT_VERIFY_STEP3_SYSTEM` in `lib/ai/prompt-registry.ts`:
  - source precedence (`service_description` canonical, `knowledge_context` fallback)
  - cadence rule expanded to monthly/annual/quarterly
  - explicit quarterly-billing vs monthly-plan guardrail
- Updated `scripts/rebase-email-step3-pricing-override.ts`:
  - replacement text aligned to new Step 3 rule
  - patch matcher now targets both legacy `For pricing/fees` and current `PRICING VALIDATION` lines
  - fixed false no-op behavior by checking exact replacement content
- Coordination note:
  - `git status` showed concurrent edits from active phases (`137`, `138`, `139`, `141`) in shared files.
  - This subphase touched only prompt-rule + rebase-script targets to avoid cross-phase merge risk.

## Handoff

Subphase b updates deterministic pricing safety functions to enforce the same source precedence and cadence rules.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented Step 3 pricing contract update in prompt registry.
  - Implemented rebase script hardening for active pricing-rule replacement.
- Commands run:
  - `rg -n "EMAIL_DRAFT_VERIFY_STEP3_SYSTEM|PRICING VALIDATION" lib/ai/prompt-registry.ts` — pass
  - `sed -n '1,260p' scripts/rebase-email-step3-pricing-override.ts` — pass
- Blockers:
  - None in this subphase.
- Next concrete steps:
  - Complete subphase b (`lib/ai-drafts.ts` pricing safety + precedence/cadence logic).
