# Phase 85c — Backend Enforcement: Read-Only Settings + AI Personality Locks + Prompt/Cost Admin-Only

## Focus
Guarantee that client portal users cannot mutate Settings/AI personality and cannot access prompt/cost internals, even via direct server action calls.

## Inputs
- Phase 85a capabilities helper
- Current write paths:
  - `actions/settings-actions.ts` (workspace settings + knowledge assets + calendar links)
  - `actions/ai-persona-actions.ts` (AI persona CRUD)
  - `actions/ai-observability-actions.ts` (prompt templates/overrides + observability)

## Work
1. **Block settings writes for CLIENT_PORTAL**
   - In all settings mutation server actions, compute capabilities and reject if `isClientPortalUser === true`.
   - Preserve existing semantics for internal roles unless explicitly changed (avoid accidental regressions).
2. **Block AI personality edits**
   - Ensure AI persona create/update/delete/set-default requires admin (already mostly true); also block any legacy personality writes via `updateUserSettings` when client portal.
3. **Keep prompt/cost admin-only**
   - Verify `ai-observability` server actions remain `requireClientAdminAccess` only.
   - Audit other endpoints to ensure prompt templates/overrides are never returned to non-admin.
4. **Consistent errors**
   - Return structured errors (existing `{ success: false, error: "Unauthorized" }` pattern).

## Output
- Added `requireSettingsWriteAccess()` in `actions/settings-actions.ts` and applied it to all settings mutations (AI signature/personality, automation rules, follow-up pause/resume, knowledge assets, calendar links).
- Read-only settings endpoints (`getUserSettings`, `getAutoFollowUpsOnReply`, `getCalendarLinks`) remain accessible via `requireClientAccess`.
- AI persona CRUD and AI observability remain admin-gated via `requireClientAdminAccess` (no changes required).

## Coordination Notes
**Potential conflicts:** `actions/settings-actions.ts` has in-flight edits from other phases; re-read before further changes.
**Files affected:** `actions/settings-actions.ts`.

## Handoff
Proceed to **Phase 85d** to implement read-only Settings UI and hide prompt/cost sections for client portal users.
