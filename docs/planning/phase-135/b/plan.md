# Phase 135b — Strengthen Step 2 Generation Prompt Pricing Guards

## Focus

Strengthen the pricing instruction in Step 2 (draft generation) prompts across all channels (email, SMS, LinkedIn) to require exact-match pricing from source material rather than the current weaker "no made-up numbers" instruction.

## Inputs

- Subphase 135a completed (Step 3 verifier updated)
- Current email pricing guard: `lib/ai-drafts.ts:846` in `buildEmailPrompt()`
- SMS prompt: `buildSmsPrompt()` — check for equivalent pricing rule
- LinkedIn prompt: `buildLinkedInPrompt()` — check for equivalent pricing rule
- Template-based email prompt: `lib/ai/prompt-registry.ts:258+` (`DRAFT_EMAIL_SYSTEM_TEMPLATE`)

## Work

1. **Read** `lib/ai-drafts.ts` and locate the pricing instruction in each prompt builder:
   - `buildEmailPrompt()` (~line 846)
   - `buildSmsPrompt()` (~line 628-705)
   - `buildLinkedInPrompt()` (~line 707-765)

2. **Replace** the pricing guard in `buildEmailPrompt()` at line 846:

   **Current:**
   ```
   - Never use pricing placeholders like ${PRICE}, $X-$Y, or made-up numbers. If pricing isn't explicitly present in OFFER or Reference Information, ask one clarifying question and offer a quick call.
   ```

   **New:**
   ```
   - Never use pricing placeholders like ${PRICE}, $X-$Y, or made-up numbers. If you mention pricing, the dollar amount MUST exactly match a price/fee/cost stated in OFFER or Reference Information — do not round, estimate, or invent. If no pricing is explicitly present in those sections, do not state any dollar amount; instead ask one clarifying question and offer a quick call.
   ```

3. **Apply** the same change to `buildSmsPrompt()` and `buildLinkedInPrompt()` if they contain equivalent pricing rules

4. **Check** if the template-based prompt `DRAFT_EMAIL_SYSTEM_TEMPLATE` also has a pricing instruction and update it if so

## Output

Updated pricing guards in all three prompt builders in `lib/ai-drafts.ts` and the template in `lib/ai/prompt-registry.ts` (if applicable).

## Handoff

Subphase c adds a programmatic post-processing safety net to detect pricing hallucinations that slip through both Step 2 and Step 3.
