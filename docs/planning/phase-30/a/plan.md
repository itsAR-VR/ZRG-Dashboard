# Phase 30a — Schema + Settings Plumbing: Draft Generation Model Settings

## Focus

Add new fields to `WorkspaceSettings` to control which model and reasoning level is used for *email draft strategy generation* (Step 1), and plumb them through server settings actions.

## Inputs

- Current `WorkspaceSettings` schema in `prisma/schema.prisma`
- Existing pattern:
  - `WorkspaceSettings.insightsChatModel` / `WorkspaceSettings.insightsChatReasoningEffort` in `prisma/schema.prisma`
  - Admin-gated updates in `actions/settings-actions.ts`

## Work

### 1) Prisma schema changes

Add new fields to `WorkspaceSettings` model:
   ```prisma
   // Draft Generation Model Settings
   draftGenerationModel           String? @default("gpt-5.1") // gpt-5.1 | gpt-5.2
   draftGenerationReasoningEffort String? @default("medium")  // low | medium | high | extra_high (gpt-5.2 only)
   ```

### 2) Settings action plumbing

Update `actions/settings-actions.ts`:
- Extend `UserSettingsData` with:
  - `draftGenerationModel: string | null`
  - `draftGenerationReasoningEffort: string | null`
- Populate defaults in the “no workspace selected” return object:
  - `draftGenerationModel: "gpt-5.1"`
  - `draftGenerationReasoningEffort: "medium"`
- Map DB → return payload in `getUserSettings()`
- Persist the new fields in `updateUserSettings()` `upsert` (both `update` and `create`)
- Decide gating: follow the existing “workspace-wide, admin-only” pattern (recommended) by including these fields in the admin-required update check.

### 3) Apply schema

- Run `npm run db:push` to apply schema changes
- Verify in Prisma Studio that fields exist and defaults are present

## Output

**Completed:**
- Updated `prisma/schema.prisma` (lines 169-171): Added `draftGenerationModel` (default "gpt-5.1") and `draftGenerationReasoningEffort` (default "medium") to WorkspaceSettings
- Updated `actions/settings-actions.ts`:
  - Extended `UserSettingsData` interface (lines 30-32)
  - Added defaults in "no workspace selected" return (lines 121-122)
  - Mapped DB → return payload in `getUserSettings()` (lines 219-220)
  - Added admin-gating check for draft generation updates (lines 278-282)
  - Persisted fields in `updateUserSettings()` upsert - both update (lines 299-300) and create (lines 346-347) blocks
- Database schema updated via `npm run db:push` (success)
- Prisma client regenerated via `npx prisma generate`
- Type check passes for settings-actions.ts changes

## Handoff

Schema + settings plumbing are complete. Phase 30b can now:
1. Read `settings.draftGenerationModel` and `settings.draftGenerationReasoningEffort` from the workspace settings
2. Use coercion helpers to validate/default values before passing to OpenAI
3. The UI (Phase 30c) can call `updateUserSettings()` with these fields (admin-only)
