# Phase 1c — Admin Onboarding + Integrations UI for Assignments

## Focus
Give admins an intuitive UI to:
- Create/maintain setter accounts (or invite them)
- Assign client workspaces to setters/inbox managers during onboarding
- Edit assignments later from Settings → Integrations

## Inputs
- Phase 1a assignment model
- Phase 1b authorization rules and helper utilities
- Existing UI entry points:
  - Settings → Integrations: `components/dashboard/settings/integrations-manager.tsx`
  - Workspace provisioning endpoint: `app/api/admin/workspaces/route.ts`

## Work
- Decide the admin workflow for setter account creation:
  - Invite flow via Supabase (recommended) vs. manual pre-created accounts
  - Minimum metadata to store in Prisma (if any) for display names/roles
- Extend “Add Workspace” flow to include:
  - Setter assignment (required/optional)
  - Inbox manager assignment (required/optional)
- Extend per-workspace edit UI in Integrations tab:
  - View current assigned setter/inbox manager
  - Update assignment with validation and clear confirmation UX
- Ensure setters cannot access this assignment UI unless explicitly allowed

## Output
- **Admin workflow decision**
  - For Phase 1: setters create accounts via existing Supabase Auth signup/login flow (or admin can set passwords via the existing admin endpoint). Admin assigns access by email from the Integrations UI.
  - No “invite users” UI shipped in this phase (can be added later without changing the assignment model).
- **Assignments UI shipped in Settings → Integrations**
  - `components/dashboard/settings/integrations-manager.tsx` now supports:
    - setting **Setter email(s)** and **Inbox manager email(s)** on workspace creation
    - viewing/editing assignments per workspace (admin-only) via an “Assignments” section in the inline edit panel
    - hiding admin-only actions (create/delete/sync/configure) for non-admin users
- **Server-side support**
  - Added `actions/client-membership-actions.ts`:
    - `getClientAssignments(clientId)` (admin-only)
    - `setClientAssignments(clientId, { setterEmailsRaw, inboxManagerEmailsRaw })` (admin-only; email→userId resolved via Supabase admin APIs; safe failure on unknown users)
  - Added `lib/supabase/admin.ts` for Supabase service-role lookups (email→userId + userId→email)
  - Added `actions/access-actions.ts` for UI gating (`getGlobalAdminStatus`)

## Handoff
Phase 1d wires provisioning automation to accept Inbox Manager email and auto-assign using the same assignment logic used by the UI.
