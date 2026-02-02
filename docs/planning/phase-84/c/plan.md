# Phase 84c — Wire Into Follow-Up Engine + Editor Validation UX

## Focus
Use Spintax during follow-up execution (subject + message content) and add save-time validation surfaced in the follow-up sequence editor UI.

## Inputs
- Updated strict renderer from Phase 84b
- Existing follow-up generation call sites in `lib/followup-engine.ts`
- Follow-up sequence editor: `components/dashboard/followup-sequence-manager.tsx`
- Save actions: `actions/followup-sequence-actions.ts`

## Work
1. Follow-up execution integration (`lib/followup-engine.ts`):
   - In `generateFollowUpMessage()`, compute:
     - `stepKey = step.id || \`order-${step.stepOrder}\`` (RED TEAM fix: fallback for preview/unsaved steps)
     - `spintaxSeed = \`${lead.id}:${stepKey}\``
   - Pass `spintaxSeed` to `renderFollowUpTemplateStrict()` for both:
     - `step.messageTemplate`
     - `step.subject` (email only)
   - Ensure approval tasks store expanded content (already true if generated content is expanded before task creation).
2. Save-time validation (`actions/followup-sequence-actions.ts`):
   - Validate `messageTemplate` and `subject` for Spintax syntax using `validateSpintax()`.
   - If invalid, return a structured error that blocks save (similar to unknown-token validation).
3. UI feedback (`components/dashboard/followup-sequence-manager.tsx`):
   - Add lightweight help text near “Message Template” (and “Subject Line” for email): `Spintax: [[Hi|Hey|Hello]] (chosen per lead)`
   - Surface Spintax syntax errors per step (e.g., a red callout similar to “Unknown variables”).
   - Ensure the UI messaging aligns with server validation so users know why saving is blocked.

## Output
- Follow-up execution uses Spintax deterministically per lead+step via `spintaxSeed = ${lead.id}:${stepKey}`.
- Save-time validation blocks malformed Spintax in create/update/toggle flows.
- Sequence editor surfaces syntax errors and provides a clear "how to use" hint for subject + message.

## Validation (RED TEAM)

- `npm run lint` — no errors
- `npm run build` — TypeScript compiles without errors
- Manual test: Create a sequence with step containing `[[Hi|Hey|Hello]] {firstName}` → save succeeds
- Manual test: Create a sequence with step containing `[[a|b` (malformed) → save blocked with error message
- Manual test: Trigger follow-up for same lead+step twice (via cron or manual) → same variant rendered

## Handoff
- Phase 84d adds unit tests and runs validation (`npm run test`, `npm run build`, `npm run lint`).
- Add tests for deterministic expansion and invalid Spintax blocking.
