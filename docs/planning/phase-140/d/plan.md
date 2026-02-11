# Phase 140d - Apply Founders Club Override Rebase + Runtime Verification

## Focus

Rebase Founders Club `PromptOverride` for `draft.verify.email.step3.v1` after deployment so override content matches the new Step 3 pricing contract (source precedence + cadence-safe wording), then verify runtime behavior.

## Inputs

- Subphases 140a-140c completed and merged
- `scripts/rebase-email-step3-pricing-override.ts`
- Founders Club `clientId`: `ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`

## Work

1. Deploy updated code so runtime base hash is current.
2. Rebase Founders Club override:
   - preferred: script path
   - fallback: SQL path (same pattern as Phase 135d)
   - preserve custom rules 9-15
3. Verify override activation:
   - Step 3 telemetry prompt key includes workspace suffix (`ws_...`)
   - override content contains updated pricing precedence + cadence rules
4. Runtime verification on pricing inquiry:
   - valid pricing retained when source is supported
   - conflict follows serviceDescription
   - quarterly-billing workspace copy does not imply a monthly payment plan

## Output

- Founders Club Step 3 override rebased to new contract
- Runtime evidence confirms pricing + cadence behavior is correct

## Handoff

Subphase e adds evaluator-side cadence mismatch guardrails and observability.
