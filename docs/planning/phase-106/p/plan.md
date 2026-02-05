# Phase 106p — Implementation: “More info” responses use offer/knowledge (no default website)

## Focus
Ensure “send me more info” replies pull from service description + knowledge assets, and do not default to sharing the website unless explicitly asked.

## Inputs
- Draft prompts: `lib/ai-drafts.ts`
- Response strategy mapping: `lib/ai-drafts.ts`

## Work
1. Update SMS/LinkedIn/Email prompt guidelines to treat “more info” as offer/knowledge context, not a website request.
2. Update email draft strategy/generation instructions to include concrete offer/knowledge details when “more info” is requested.
3. Update `Information Requested` response strategy to reflect the above behavior.

## Output
- Prompt guidance now uses service description + knowledge assets for “more info” requests.
- Website is only mentioned when explicitly requested for a link/website.
- Response strategy for “Information Requested” aligns with the above.
- Coordination: Phase 107 also touches `lib/ai-drafts.ts`; changes here are additive prompt guidance only.

## Handoff
Run validation subphase (Phase 106n) to re-run tests/lint/build and record evidence.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Updated SMS/LinkedIn/Email prompt guidelines to treat “more info” as offer/knowledge context.
  - Added email strategy/generation instruction to include concrete offer/knowledge details and avoid defaulting to website.
  - Updated `Information Requested` response strategy wording accordingly.
- Commands run:
  - `rg -n "website|more info|send me" lib/ai-drafts.ts` — locate prompt sites (pass)
  - `sed -n '520,1210p' lib/ai-drafts.ts` — review prompt sections (pass)
- Blockers:
  - None.
- Next concrete steps:
  - Validation completed in Phase 106n; update Phase 106 review summary if needed.
