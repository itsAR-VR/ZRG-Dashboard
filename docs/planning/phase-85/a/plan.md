# Phase 85a — RBAC: Schema Role + Capabilities Helper

## Focus
Introduce an explicit `CLIENT_PORTAL` membership role and a single “capabilities” helper used by both server actions and UI to enforce what client portal users can see and change.

## Inputs
- Phase 85 root plan (`docs/planning/phase-85/plan.md`)
- Existing roles/memberships: `ClientMemberRole` + `ClientMember` model in `prisma/schema.prisma`
- Existing access helpers: `lib/workspace-access.ts` (`getUserRoleForClient`, `requireClientAccess`, `requireClientAdminAccess`)

## Work
1. **Prisma**
   - Add `CLIENT_PORTAL` to `enum ClientMemberRole`.
   - Run `npm run db:push` after implementation.
2. **Role resolution**
   - Ensure `getUserRoleForClient(userId, clientId)` can return `CLIENT_PORTAL`.
   - Set role precedence so `CLIENT_PORTAL` doesn’t accidentally elevate above admin/owner (low precedence).
3. **Capabilities helper**
   - Add `lib/workspace-capabilities.ts` (or similar):
     - `getWorkspaceCapabilities(userId, clientId)` -> boolean flags:
       - `isClientPortalUser`
       - `canEditSettings` (false for CLIENT_PORTAL; preserve existing semantics for other roles unless explicitly changed)
       - `canEditAiPersonality` (false for CLIENT_PORTAL)
       - `canViewAiObservability` (false for CLIENT_PORTAL)
       - `canManageMembers` (false for CLIENT_PORTAL)
4. **Expose capabilities to UI**
   - Add a server action (recommended: extend `actions/access-actions.ts`) to return capabilities for the active workspace.
5. **Tests**
   - Unit tests validating the capability mapping for CLIENT_PORTAL vs OWNER/ADMIN.

## Output
- Added `CLIENT_PORTAL` to `ClientMemberRole` in `prisma/schema.prisma`.
- Updated role precedence in `lib/workspace-access.ts` to include `CLIENT_PORTAL`.
- Added `lib/workspace-capabilities.ts` with `getCapabilitiesForRole()` and `requireWorkspaceCapabilities()`.
- Added `getWorkspaceCapabilities()` server action in `actions/access-actions.ts`.
- Updated role unions in `lib/mock-data.ts` and `components/dashboard/crm-drawer.tsx` to include `CLIENT_PORTAL`.
- Added unit tests in `lib/__tests__/workspace-capabilities.test.ts` and registered them in `scripts/test-orchestrator.ts`.
- **Pending:** `npm run db:push` (schema change) and `prisma generate` via build/test pipeline.

## Coordination Notes
**Uncommitted conflicts:** `prisma/schema.prisma` already has in-flight changes from other phases (83/84/89). Re-read/merge schema before running `db:push`.
**Files affected:** `prisma/schema.prisma`, `lib/workspace-access.ts`, `lib/workspace-capabilities.ts`, `actions/access-actions.ts`, `lib/mock-data.ts`, `components/dashboard/crm-drawer.tsx`, `lib/__tests__/workspace-capabilities.test.ts`, `scripts/test-orchestrator.ts`.

## Handoff
Proceed to **Phase 85b** to add admin provisioning for client portal users and email login details. Use `requireWorkspaceCapabilities()` to gate admin-only actions.
