# Phase 124a — Auto Follow-ups Toggle Reliability (RBAC + Settings Permissions)

## Focus
Ensure the workspace-level **Auto Follow-ups (Positive Replies)** toggle updates successfully for authorized users (including true super-admins), tighten settings write permissions to admin-only, and add regression coverage.

## Inputs
- Jam: Auto-follow-up toggle fails with `Failed to update auto follow-up setting` (2026-02-09).
- `actions/settings-actions.ts`:
  - `getAutoFollowUpsOnReply()`
  - `setAutoFollowUpsOnReply()`
  - `requireSettingsWriteAccess()` (line 118)
- `lib/workspace-capabilities.ts` + `lib/workspace-access.ts` (true super-admin allowlist logic)
- **RED TEAM note:** The super-admin → OWNER capability fix already exists in the working tree (uncommitted, lines 41–50). This subphase validates and lands it, not re-implements it.

## Work
1. **Validate existing fix**
   - Review the uncommitted diff in `lib/workspace-capabilities.ts`.
   - Confirm the super-admin → OWNER mapping at lines 41–50 is correct:
     - `isTrueSuperAdminUser()` check → return OWNER role + full capabilities.
   - Ensure `CLIENT_PORTAL` users remain blocked from settings writes.
2. **Tighten settings write permissions** (RED TEAM GAP-2)
   - Change `requireSettingsWriteAccess()` in `actions/settings-actions.ts:118-122` from:
     ```typescript
     if (capabilities.isClientPortalUser) {
       throw new Error("Unauthorized");
     }
     ```
     to:
     ```typescript
     if (!capabilities.canEditSettings) {
       throw new Error("Unauthorized");
     }
     ```
   - This restricts settings writes to OWNER + ADMIN only. SETTER and INBOX_MANAGER become read-only for settings.
3. **Regression coverage**
   - Add/extend unit tests for capabilities mapping:
     - true super-admin → `canEditSettings=true`, `isWorkspaceAdmin=true`
     - ADMIN → `canEditSettings=true`
     - SETTER → `canEditSettings=false`
     - INBOX_MANAGER → `canEditSettings=false`
     - CLIENT_PORTAL → `canEditSettings=false`, `isClientPortalUser=true`
   - Test `requireSettingsWriteAccess` rejects SETTER/INBOX_MANAGER/CLIENT_PORTAL.
4. **Manual verification**
   - In app: toggle ON/OFF; confirm persistence on refresh.
   - Confirm settings remain read-only for non-admin roles.

## Files Modified
- `lib/workspace-capabilities.ts` — validate + commit existing fix
- `actions/settings-actions.ts` — tighten `requireSettingsWriteAccess()`
- `lib/__tests__/workspace-capabilities.test.ts` — new/extended tests

## Output
- Toggle works without error for super-admin sessions and persists state.
- Settings writes restricted to OWNER + ADMIN roles.
- Capability mapping + settings access has unit test coverage.

## Handoff
Proceed to **Phase 124b** to harden SMS follow-up execution paths (hydration + blocking + DND retry + scheduling).

## Progress This Turn (Terminus Maximus)
- Work done:
  - Treated true super-admin sessions as `OWNER` for capability purposes so RBAC-gated settings actions work even when the user is not an explicit workspace member. (file: `lib/workspace-capabilities.ts`)
  - Tightened settings writes to admin-only by switching the write guard to `capabilities.canEditSettings` (OWNER + ADMIN). (file: `actions/settings-actions.ts`)
  - Kept reads permissive by changing `getAutoFollowUpsOnReply()` to `requireClientAccess()` while keeping writes admin-gated. (file: `actions/settings-actions.ts`)
  - Added regression coverage for the super-admin allowlist helper. (file: `lib/__tests__/workspace-access-super-admin.test.ts`)
- Commands run:
  - `npm test` — pass (261 tests)
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass
- Blockers:
  - Manual QA still needed to confirm the toggle end-to-end in the UI for a real super-admin session.
- Next concrete steps:
  - Verify toggle behavior in staging/prod (super-admin + workspace ADMIN).
  - Continue with Phase 124b SMS follow-up hardening work (already implemented in code; see Phase 124b progress).
