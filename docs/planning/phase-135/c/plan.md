# Phase 135c — Programmatic Pricing Validation Safety Net + Telemetry

## Focus

Add a code-level pricing validation function that runs on the **final draft** for all channels (email/SMS/LinkedIn). It extracts dollar amounts that look like pricing, compares them against the source material (serviceDescription + knowledgeContext), and logs a telemetry warning for any hallucinated prices. This provides observability and a foundation for future auto-correction.

## Inputs

- Subphases 135a and 135b completed (prompt-level fixes in place)
- Existing sanitization function: `lib/ai-drafts.ts:100-221` (`sanitizeDraftContent`, `PRICING_PLACEHOLDER_REGEX`)
- Existing pricing placeholder test: `lib/__tests__/ai-drafts-pricing-placeholders.test.ts`
- Final post-pass block: `lib/ai-drafts.ts:~2938` (booking link enforcement + em-dash replacement + sanitize + persist)
- AIInteraction logging pattern used throughout `lib/ai-drafts.ts`

## Work

1. **Add** a new function `detectPricingHallucinations(draft, serviceDescription, knowledgeContext)` in `lib/ai-drafts.ts` near the existing sanitization functions (~line 221):

   ```typescript
   /**
    * Extracts dollar amounts from text that look like pricing (not revenue thresholds).
    * Returns numeric values for comparison.
    */
   function extractPricingAmounts(text: string): number[] {
     // Match dollar amounts like $791, $3,000, $25,000, $500/month, $9,500/year.
     // Exclude obvious thresholds like $1M+ / $2.5M raised / $50M ARR / $500k revenue.
     // Heuristic approach:
     // - Exclude suffixes K/M/B by default.
     // - Exclude amounts near threshold keywords (revenue/arr/raised/funding/valuation).
     // - Prefer amounts near pricing keywords (price/fee/cost/membership/per month/year).
     // ... normalize to numbers, return array
   }

   function detectPricingHallucinations(
     draft: string,
     serviceDescription: string | null,
     knowledgeContext: string | null
   ): { hallucinated: number[]; valid: number[]; allDraft: number[] } {
     const draftAmounts = extractPricingAmounts(draft);
     const sourceText = [serviceDescription ?? "", knowledgeContext ?? ""].join("\n");
     const sourceAmounts = new Set(extractPricingAmounts(sourceText));

     const hallucinated = draftAmounts.filter(a => !sourceAmounts.has(a));
     const valid = draftAmounts.filter(a => sourceAmounts.has(a));

     return { hallucinated, valid, allDraft: draftAmounts };
   }
   ```

2. **Call** `detectPricingHallucinations()` on the final draft (all channels), after the hard post-pass + `sanitizeDraftContent()`:

   ```typescript
   const pricingCheck = detectPricingHallucinations(draftContent, serviceDescription, knowledgeContext);
   if (pricingCheck.hallucinated.length > 0) {
     // Log to AIInteraction for observability
     console.warn(`[pricing-hallucination] Lead ${leadId}: draft contains $${pricingCheck.hallucinated.join(", $")} not found in source material`);
     // Optional: attach to the most relevant AIInteraction record (Step 3 interaction for email; Step 2 generation for SMS/LinkedIn)
   }
   ```

   Placement note:
   - Email: this runs *after* Step 3 verifier and after `enforceCanonicalBookingLink` / `replaceEmDashesWithCommaSpace` / forbidden-term stripping.
   - SMS/LinkedIn: this runs after generation + sanitize (there is no Step 3 verifier).

3. **Add tests** in a new test file or extend `lib/__tests__/ai-drafts-pricing-placeholders.test.ts`:
   - `extractPricingAmounts("$791/month and $9,500/year")` → `[791, 9500]`
   - `extractPricingAmounts("$1M+ in revenue")` → `[]` (excluded as threshold)
   - `extractPricingAmounts("$50M ARR")` → `[]`
   - `extractPricingAmounts("$500k raised")` → `[]`
   - `extractPricingAmounts("$3,000 one-time")` → `[3000]`
   - `detectPricingHallucinations("Our fee is $3,000", null, "Pricing: $791 per month")` → `hallucinated: [3000], valid: []`
   - `detectPricingHallucinations("It works out to $791/month", null, "Pricing: $791 per month")` → `hallucinated: [], valid: [791]`

## Output

- `detectPricingHallucinations()` function in `lib/ai-drafts.ts`
- Telemetry logging for hallucinated prices in the post-Step3 block
- Unit tests for the extraction and validation logic
- `npm run build` and `npm run lint` pass
- Existing pricing placeholder tests unaffected

## Handoff

Phase 135 complete. Monitor `AIInteraction` records for `pricing_hallucination_detected` classifications post-deploy. If hallucinations persist despite prompt changes (135a/135b), consider upgrading this safety net from telemetry-only to auto-correction (stripping hallucinated amounts and substituting a call redirect).

## Open Question (Need Human Input)

- Should a detected hallucinated price set `AIInteraction.status="error"` via `markAiInteractionError(...)` (visible in observability), or should we implement a separate “warning”/metadata-only logging method to avoid inflating error counts? (confidence <90%)
