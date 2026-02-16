# Phase 156c — `AI Personality` Reduction and Model/Control Migration

## Focus
Refactor `AI Personality` into persona/content-only setup and migrate model selector plus operational control surfaces into `Admin`.

## Inputs
- `docs/planning/phase-156/plan.md`
- Phase `156a` migration matrix
- Phase `156b` Admin section contract
- `components/dashboard/settings-view.tsx`

## Work
1. Keep in `AI Personality` only:
   - `AiPersonaManager`
   - shared persona content inputs (qualification questions, knowledge assets, primary website)
2. Move to `Admin -> Model Selector`:
   - Campaign Strategist model/reasoning settings
   - Email Draft Generation model/reasoning settings
   - Email Draft Verification (Step 3) model settings
3. Move to `Admin -> Controls`:
   - AI route toggles and route switch activity
   - operational toggles currently in AI ops surfaces
   - follow-up operational pause/resume card
   - bulk draft regeneration control
4. Remove moved content from `AI Personality` to eliminate duplicate ownership.

## Validation
- `npm run test:ai-drafts`
- Confirm moved settings still round-trip via existing save/load flow.

## Output
- Clean `AI Personality` tab and Admin-hosted model/control configuration with unchanged persistence behavior.

## Handoff
Phase `156d` removes remaining duplicates and finalizes access/visibility behavior in Admin.

## Status
- Completed

## Progress This Turn (Terminus Maximus)
- Reduced `AI Personality` to persona/content setup only (persona manager + qualification/knowledge/website inputs).
- Migrated all model-selector cards into `admin > Model Selector`.
- Migrated operational control cards into `admin > Controls`.
- Removed migrated cards from `AI Personality` to remove duplicate ownership boundaries.

## Persistence/Behavior Notes
- No schema or API changes.
- Existing settings round-trip behavior remains bound to existing form state and `handleSaveSettings`.
