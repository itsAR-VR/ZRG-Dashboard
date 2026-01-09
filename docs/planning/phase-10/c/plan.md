# Phase 10c — Minimal Reply Prompt Edits to Ask for Timeline on Deferrals

## Focus
When a lead signals “not now / not ready”, generate a reply that captures timeline and keeps the door open—without pushing a meeting or sounding automated.

## Inputs
- Phase 10a: example set + desired response goals
- Current draft prompt builders + strategies:
  - `lib/ai-drafts.ts` (`getResponseStrategy`, `buildSmsPrompt`, `buildEmailPrompt`)
  - `lib/ai/prompt-registry.ts` draft templates (if applicable)

## Work
1. Adjust the “Follow Up” response strategy to:
   - Acknowledge politely
   - Ask a single, low-friction timeline question (offer 2–3 buckets)
   - Ask permission to check back
2. Keep SMS constraints in mind (short, no pressure).
3. Ensure “Not Interested” stays respectful and doesn’t try to salvage aggressively.
4. Enable draft generation for “Follow Up” by widening the existing draft whitelist (no new workflows/helpers):
   - Update `shouldGenerateDraft` to allow `Follow Up` (while keeping Blacklist/Automated Reply/OOO excluded).
   - This automatically affects webhook-driven draft creation and the “regenerate draft” path (both already call `shouldGenerateDraft`).

## Output
- Enabled draft generation for `Follow Up` (deferrals) without adding new workflows:
  - `shouldGenerateDraft` now allows `Follow Up`: `lib/ai-drafts.ts`
  - Existing webhook + regenerate-draft paths automatically inherit this behavior (they already call `shouldGenerateDraft`)
- Updated `Follow Up` response strategy to ask for timeline + permission to check back (no meeting push): `lib/ai-drafts.ts`
- Prevented “Follow Up” drafts from automatically offering availability/meeting times by excluding it from scheduling logic: `lib/ai-drafts.ts`

## Handoff
Proceed to Phase 10d: sanity-check classifications/drafts against `docs/planning/phase-10/examples.md` and monitor live outcomes (reduced “not ready → unqualified” handling).
