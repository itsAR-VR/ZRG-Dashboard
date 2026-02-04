# Phase 104a — Schema + Settings Actions Wiring

## Focus
Add a workspace setting for Step 3 verifier model and expose it through `getUserSettings`/`updateUserSettings`.

## Inputs
- `prisma/schema.prisma` (`WorkspaceSettings`)
- `actions/settings-actions.ts` (`UserSettingsData`, `getUserSettings`, `updateUserSettings`)

## Work
- Add `WorkspaceSettings.emailDraftVerificationModel` with default `gpt-5.2`.
- Extend `UserSettingsData` with `emailDraftVerificationModel`.
- Map field in `getUserSettings` default + db-backed settings.
- Allow admin-gated updates via `updateUserSettings`.

## Validation
- `npm run db:push`
- `npm run build` (ensures Prisma client + TS compile)

## Output
Shipped schema + settings actions wiring:
- `WorkspaceSettings.emailDraftVerificationModel` added (default `gpt-5.2`).
- `actions/settings-actions.ts`:
  - `UserSettingsData.emailDraftVerificationModel`
  - `getUserSettings()` returns the value (fallback `gpt-5.2`)
  - `updateUserSettings()` supports admin-gated updates for the field.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added per-workspace setting to Prisma schema and exposed it via settings actions.
- Commands run:
  - `npm run db:push` — pass
- Blockers:
  - None
- Next concrete steps:
  - Add the UI control in Settings → AI Personality.

## Handoff
Proceed to Phase 104b to add the UI control in Settings → AI Personality.
