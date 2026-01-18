# Phase 33f — AI Personality ICP Field (Settings UI)

## Focus

Add a dedicated ICP field to AI Personality settings so workspaces can define “ideal customer profile” context for lead scoring.

## Inputs

- Schema changes from Phase 33a (`WorkspaceSettings.idealCustomerProfile`)
- Settings UI: `components/dashboard/settings-view.tsx`
- Settings actions: `actions/settings-actions.ts`

## Work

1. **Extend settings read/write paths**
   - Update `actions/settings-actions.ts` to read/write `idealCustomerProfile` on `WorkspaceSettings`.
   - Ensure any settings fetch used by the UI includes the new field.

2. **Add UI control under AI Personality**
   - Add a textarea labeled “Ideal Customer Profile (ICP)” in `components/dashboard/settings-view.tsx`.
   - UX:
     - Optional field (can be blank).
     - Save behavior should match other AI Personality fields.

3. **Confirm end-to-end wiring**
   - Ensure the saved ICP is persisted to DB and is available to scoring prompts (Phase 33b).

## Validation (RED TEAM)

- Update the field in the UI, refresh, confirm value persists.
- Ensure no secrets are stored; ICP is plain text business context.

## Output

**Completed 2026-01-17:**

1. **Extended settings read/write paths:**
   - Added `idealCustomerProfile` field to `UserSettingsData` interface in `actions/settings-actions.ts`
   - Added to default settings (null) and settings fetch return object
   - Added `idealCustomerProfile` to `updateAIPersonality` data parameter and upsert calls

2. **Added UI control under AI Personality:**
   - Added `idealCustomerProfile` to `aiPersona` state in `settings-view.tsx`
   - Added to state initialization on settings fetch
   - Added to save payload
   - Added textarea UI with Target icon, placeholder text, and helper description
   - Located after Service Description section, before Qualification Questions

- Workspaces can set/update an ICP field in AI Personality settings.

## Handoff

Phase 33b/33c use the ICP field as part of the scoring context.

