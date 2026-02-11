# Phase 135b — Strengthen Step 2 Generation Prompt Pricing Guards

## Focus

Strengthen the pricing instruction in Step 2 (draft generation) prompts across all channels (email, SMS, LinkedIn) to require exact-match pricing from source material rather than the current weaker "no made-up numbers" instruction.

## Inputs

- Subphase 135a completed (Step 3 verifier updated)
- Email two-step prompts (hot path):
  - Step 1 strategy system instructions: `lib/ai-drafts.ts` → `buildEmailDraftStrategyInstructions()` (~line 1023)
  - Step 2 generation system instructions: `lib/ai-drafts.ts` → `buildEmailDraftGenerationInstructions()` (~line 1151)
- Email single-step fallback prompt (only used when two-step fails): `lib/ai-drafts.ts` → `buildEmailPrompt()` (~line 846)
- SMS/LinkedIn hot-path templates (used by `generateResponseDraft()` via prompt registry):
  - `lib/ai/prompt-registry.ts` → `DRAFT_SMS_SYSTEM_TEMPLATE` (promptKey `draft.generate.sms.v1`)
  - `lib/ai/prompt-registry.ts` → `DRAFT_LINKEDIN_SYSTEM_TEMPLATE` (promptKey `draft.generate.linkedin.v1`)
- SMS/LinkedIn fallback prompts (used only if registry template is missing/empty):
  - `lib/ai-drafts.ts` → `buildSmsPrompt()` (~line 628)
  - `lib/ai-drafts.ts` → `buildLinkedInPrompt()` (~line 707)
- Prompt override drift model: any existing `PromptOverride` / `SystemPromptOverride` for these prompt keys must be updated (re-saved) after code-default edits, otherwise they will be silently ignored due to `baseContentHash` mismatch.

## Work

1. **Email two-step: add an explicit pricing exact-match contract to Step 1 strategy.**
   - Update `buildEmailDraftStrategyInstructions()` to include:
     - If the lead asks about pricing/cost/fee and pricing is present in OUR OFFER or REFERENCE INFORMATION, the strategy must include the exact dollar amounts verbatim in `intent_summary` and/or the `outline` bullets.
     - If pricing is NOT explicitly present, the strategy must plan to ask one clarifying question and must not invent a dollar amount.

2. **Email two-step: add a pricing guard to Step 2 generation.**
   - Update `buildEmailDraftGenerationInstructions()` to include:
     - If you mention pricing, only use dollar amounts that appear in the STRATEGY section (intent/outline). Do not round, estimate, or invent.
   - This keeps the generation model aligned to the strategy output (which was grounded to offer/knowledge in Step 1).

3. **Update the email single-step fallback pricing guard** in `buildEmailPrompt()` (~line 846):

   **Current:**
   ```
   - Never use pricing placeholders like ${PRICE}, $X-$Y, or made-up numbers. If pricing isn't explicitly present in OFFER or Reference Information, ask one clarifying question and offer a quick call.
   ```

   **New:**
   ```
   - Never use pricing placeholders like ${PRICE}, $X-$Y, or made-up numbers. If you mention pricing, the numeric dollar amount MUST match a price/fee/cost stated in OFFER or Reference Information — do not round, estimate, or invent. If no pricing is explicitly present in those sections, do not state any dollar amount; instead ask one clarifying question and offer a quick call.
   ```

4. **Update SMS + LinkedIn hot-path system templates** in `lib/ai/prompt-registry.ts`:
   - Add the same “numeric dollar amount must match explicitly stated pricing in About Our Business / Reference Information” rule to:
     - `DRAFT_SMS_SYSTEM_TEMPLATE` Guidelines section
     - `DRAFT_LINKEDIN_SYSTEM_TEMPLATE` Guidelines section

5. **Update SMS + LinkedIn fallback prompt builders** (`buildSmsPrompt()`, `buildLinkedInPrompt()`) with the same “exact-match pricing” wording so fallback behavior matches the registry templates.

6. **(Optional sanity check)** If there are active `PromptOverride` / `SystemPromptOverride` records for `draft.generate.sms.v1` or `draft.generate.linkedin.v1`, re-save them with the same pricing guardrail so they don’t keep weaker/legacy wording.

## Output

Updated pricing exact-match guards on the **hot paths**:
- Email two-step strategy + generation instructions in `lib/ai-drafts.ts`
- Email fallback prompt in `lib/ai-drafts.ts`
- SMS/LinkedIn registry templates in `lib/ai/prompt-registry.ts` (plus fallback builders for consistency)

## Handoff

Subphase c adds a programmatic post-processing safety net to detect pricing hallucinations that slip through both Step 2 and Step 3.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Strengthened pricing guardrails in email strategy/generation instructions (`buildEmailDraftStrategyInstructions`, `buildEmailDraftGenerationInstructions`) so pricing must be grounded before generation and reused exactly.
  - Updated fallback prompt builders (`buildEmailPrompt`, `buildSmsPrompt`, `buildLinkedInPrompt`) to enforce exact numeric pricing matches and clarifying-question fallback when no explicit pricing exists.
  - Updated hot-path prompt templates in `lib/ai/prompt-registry.ts` for SMS and LinkedIn to match the new exact-match pricing policy.
  - Adjusted email Step 2 input to use latest inbound content, aligning with prompt-editing flow and reducing drift between strategy/generation context.
- Commands run:
  - `npm test` — pass
  - `npm run lint` — pass with warnings
  - `npm run build` — pass
- Blockers:
  - None for prompt-level code changes.
- Next concrete steps:
  - If workspace/system overrides exist for `draft.generate.sms.v1` or `draft.generate.linkedin.v1`, re-save those overrides with the new pricing rule to avoid stale hash drift behavior.
