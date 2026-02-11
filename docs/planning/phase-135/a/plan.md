# Phase 135a — Strengthen Step 3 Pricing Validation (Code Default + Workspace Override)

## Focus

Make the Step 3 verifier **actively scan** every dollar amount in a draft and validate it against the provided source material. Update BOTH the code default AND the Founders Club workspace override to include the stronger pricing rule while preserving Founders Club's custom rules (9-15).

## Inputs

- Current Step 3 code default: `lib/ai/prompt-registry.ts` line 226-256 (`EMAIL_DRAFT_VERIFY_STEP3_SYSTEM`)
- Current Founders Club override: `PromptOverride` table, `promptKey = 'draft.verify.email.step3.v1'`, `clientId` for Founders Club
- Override resolution logic: `lib/ai/prompt-registry.ts` → `getPromptWithOverrides()` (line ~1616)
- Override CRUD actions: `actions/ai-observability-actions.ts` → `savePromptOverride()`
- Drift detection uses `baseContentHash` — changing code default will invalidate existing overrides until they are re-saved (hash rebased)
- System-default overrides (Phase 129): `SystemPromptOverride` table can also override the code default (precedence: workspace > system > code)

## Work

### Step 1: Update code default

In `lib/ai/prompt-registry.ts`, replace the pricing sub-rule at line 241 in `EMAIL_DRAFT_VERIFY_STEP3_SYSTEM`:

**Current (line 241):**
```
- For pricing/fees: only use values explicitly described as membership price/price/fee in the provided context (do NOT treat revenue thresholds like "$1M" as pricing).
```

**New:**
```
- PRICING VALIDATION: If the draft includes any dollar amount that implies pricing (price/fee/cost/membership/investment, per month/year, /mo, /yr), the numeric dollar amount MUST match an explicit price/fee/cost in <service_description> or <knowledge_context> (format can differ: "$791/month" matches "$791 per month"). If it does not match, remove the pricing claim or replace it with the correct amount from context. Ignore revenue/funding thresholds (e.g., "$1M+ in revenue", "$2.5M raised", "$50M ARR") and do NOT treat them as pricing. Do NOT preserve hallucinated prices.
```

### Step 2: Update Founders Club workspace override

Update the `PromptOverride` record for Founders Club's `draft.verify.email.step3.v1` to:
1. Replace the same weak pricing sub-rule (rule 5) with the stronger version above
2. **Preserve all custom rules 9-15** exactly as-is
3. Rebase the override `baseContentHash` to the new code default (so drift detection remains aligned and the override remains active)

This can be done via:
- Preferred: `savePromptOverride(clientId, { promptKey: "draft.verify.email.step3.v1", role: "system", index: 0, content })` so `baseContentHash` is recomputed correctly and a revision record is created.
- Avoid: direct SQL updates unless you also recompute `baseContentHash` using the same `computePromptMessageBaseHash` logic (otherwise the override will silently stop applying).

### Step 3: Verify override resolution

After both updates, verify that `getPromptWithOverrides('draft.verify.email.step3.v1', foundersClubClientId)` returns the updated override (not the code default), confirming the hash is aligned and the override is active.

## Output

- Updated `EMAIL_DRAFT_VERIFY_STEP3_SYSTEM` in `lib/ai/prompt-registry.ts` with stronger pricing validation
- Updated Founders Club `PromptOverride` record with the same stronger pricing rule + preserved custom rules 9-15
- Override hash aligned so Founders Club continues using their customized prompt

## Handoff

Subphase b strengthens the Step 2 generation prompts so fewer pricing hallucinations reach Step 3 in the first place.
