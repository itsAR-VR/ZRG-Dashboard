# Phase 10b — Minimal Sentiment Prompt Edits for “Not Now” vs “Never”

## Focus
Tune the sentiment classification prompt so “not ready / not right now” reliably lands in a follow-up/nurture category, while “don’t want to sell / not looking to sell” remains a hard decline.

## Inputs
- Phase 10a: example set + desired labels
- Current sentiment prompt text and category definitions:
  - `lib/ai/prompt-registry.ts` → `SENTIMENT_SYSTEM`

## Work
1. Update the shared sentiment classifier prompt to explicitly separate:
   - “not ready / not right now / maybe later” → `Follow Up`
   - “not looking to sell / don’t want to sell” → `Not Interested`
2. Ensure the email inbox analysis path can also emit `Follow Up`:
   - prompt text updated
   - allowed categories + JSON schema updated
3. Keep all structured outputs intact (no new keys; only widening enum with `Follow Up` where needed).

## Output
- **Sentiment classifier prompt updated** (clarified `Follow Up` vs `Not Interested`, added deferral guardrail, and adjusted priority order): `lib/ai/prompt-registry.ts`
- **Email inbox analyze updated to support `Follow Up`** end-to-end:
  - Prompt text: `lib/ai/prompt-registry.ts`
  - Allowed categories + JSON schema + decision rules: `lib/sentiment.ts`
  - Webhook mapping to sentiment tag: `app/api/webhooks/email/route.ts`
- **Expected behavior:** deferrals like “not ready to sell”, “not looking right now”, “maybe next year”, “in a couple years” should classify as `Follow Up` instead of `Not Interested`.

## Handoff
Proceed to Phase 10c: ensure the generated draft for `Follow Up` asks for a timeline + permission to check back, and avoid offering availability/meeting times for deferrals.
