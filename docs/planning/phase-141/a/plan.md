# Phase 141a — Schema + Server Action

## Focus

Add 3 boolean fields to WorkspaceSettings and wire them through the settings server action (load + save).

## Inputs

- `prisma/schema.prisma` — WorkspaceSettings model
- `actions/settings-actions.ts` — `UserSettingsData` interface, `getUserSettings()`, `updateUserSettings()`

## Work

1. Add to `WorkspaceSettings` in `prisma/schema.prisma`:
   ```prisma
   draftGenerationEnabled            Boolean @default(true)
   draftVerificationStep3Enabled     Boolean @default(true)
   meetingOverseerEnabled            Boolean @default(true)
   ```

2. Add 3 fields to `UserSettingsData` interface in `actions/settings-actions.ts`.

3. Add to `getUserSettings()` — include in the settings select/return, with `?? true` defaults.

4. Add to `updateUserSettings()`:
   - Include in the admin-access gate check
   - Include in both `update` and `create` blocks of the upsert

5. Run `npm run db:push`.

## Output

- Schema updated, pushed to DB
- Server action loads and saves all 3 fields
- No UI yet (that's phase 141b)

## Handoff

Phase 141b uses these fields to render switches in the Settings UI.
