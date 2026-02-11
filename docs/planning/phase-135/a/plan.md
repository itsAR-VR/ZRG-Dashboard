# Phase 135a — Strengthen Step 3 Pricing Validation (Code Default + Workspace Override)

## Focus

Make the Step 3 verifier **actively scan** every dollar amount in a draft and validate it against the provided source material. Update BOTH the code default AND the Founders Club workspace override to include the stronger pricing rule while preserving Founders Club's custom rules (9-15).

## Inputs

- Current Step 3 code default: `lib/ai/prompt-registry.ts` line 226-256 (`EMAIL_DRAFT_VERIFY_STEP3_SYSTEM`)
- Current Founders Club override: `PromptOverride` table, `promptKey = 'draft.verify.email.step3.v1'`, `clientId` for Founders Club
- Override resolution logic: `lib/ai/prompt-registry.ts` → `getPromptWithOverrides()` (line ~1525)
- Override CRUD actions: `actions/ai-observability-actions.ts` → `savePromptOverride()`
- Drift detection uses `baseContentHash` — changing code default will invalidate existing override hash

## Work

### Step 1: Update code default

In `lib/ai/prompt-registry.ts`, replace the pricing sub-rule at line 241 in `EMAIL_DRAFT_VERIFY_STEP3_SYSTEM`:

**Current (line 241):**
```
- For pricing/fees: only use values explicitly described as membership price/price/fee in the provided context (do NOT treat revenue thresholds like "$1M" as pricing).
```

**New:**
```
- PRICING VALIDATION: Scan the draft for every dollar amount presented as a price, fee, cost, or investment (e.g., "$3,000", "$500/month"). For each one, verify it exactly matches a price/fee/cost explicitly stated in <service_description> or <knowledge_context>. If a dollar amount does NOT match any known price from those sources, replace it with the correct value if one exists, or remove the pricing claim and redirect to a call. Do NOT treat revenue/funding thresholds (e.g., "$1M+ in revenue", "$2.5M+ raised") as pricing. Do NOT preserve hallucinated prices.
```

### Step 2: Update Founders Club workspace override

Update the `PromptOverride` record for Founders Club's `draft.verify.email.step3.v1` to:
1. Replace the same weak pricing sub-rule (rule 5) with the stronger version above
2. **Preserve all custom rules 9-15** exactly as-is
3. Update the `baseContentHash` to match the new code default hash (so drift detection remains aligned)

This can be done via:
- Direct DB update using `savePromptOverride()` server action pattern
- Or SQL update to the `PromptOverride` table with the new content and refreshed hash

### Step 3: Verify override resolution

After both updates, verify that `getPromptWithOverrides('draft.verify.email.step3.v1', foundersClubClientId)` returns the updated override (not the code default), confirming the hash is aligned and the override is active.

## Output

- Updated `EMAIL_DRAFT_VERIFY_STEP3_SYSTEM` in `lib/ai/prompt-registry.ts` with stronger pricing validation
- Updated Founders Club `PromptOverride` record with the same stronger pricing rule + preserved custom rules 9-15
- Override hash aligned so Founders Club continues using their customized prompt

## Handoff

Subphase b strengthens the Step 2 generation prompts so fewer pricing hallucinations reach Step 3 in the first place.
