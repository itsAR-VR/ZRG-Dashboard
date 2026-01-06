# Phase 1b — Authorization Enforcement (Setter vs Admin)

## Focus
Implement authorization so:
- Admin retains full access to all client workspaces
- Setters can access only their assigned clients
- Sensitive operations (creating/deleting workspaces, managing integrations) remain admin-only

## Inputs
- Phase 1a assignment model + role semantics
- Existing Supabase auth/session wiring (`middleware.ts`, `lib/supabase/*`)
- Existing server actions and API routes that assume `Client.userId === currentUserId`

## Work
- Inventory the “client-scoped” code paths that must enforce access:
  - Server actions (e.g., `getClients`, `updateClient`, message actions, follow-up actions)
  - API routes that accept `clientId` or infer client via `ghlLocationId` / `emailBisonWorkspaceId`
  - UI pages that fetch workspace lists and render workspace switchers
- Implement a single source of truth helper for “which clients can this user access?”:
  - Admin path: all clients for owner / agency (per Phase 1a definition)
  - Setter path: client IDs via assignment table
- Add explicit “admin-only” gating for:
  - Workspace creation/deletion
  - Integration credential updates
  - Setter assignment management (unless intentionally delegated)
- Confirm Jon’s dual-account requirement:
  - His setter account sees only his assigned clients
  - His admin account retains global access

## Output
- **Reusable access utilities**
  - Added `lib/workspace-access.ts` as the single source of truth for:
    - authenticated user lookup (`requireAuthUser`)
    - “which workspaces can this user access?” resolution (`resolveClientScope`, `getAccessibleClientIdsForUser`)
    - admin vs member checks (`requireClientAdminAccess`, `isGlobalAdminUser`)
    - lead-level authorization (`requireLeadAccessById`)
- **Primary read paths now scoped to assigned/owned workspaces**
  - Inbox: `actions/lead-actions.ts` (all-workspace views and cursor pagination now always constrain by accessible `clientId`s)
  - CRM: `actions/crm-actions.ts` (all-workspace views and cursor pagination now always constrain by accessible `clientId`s)
  - Follow-ups: `actions/followup-actions.ts` + `actions/followup-sequence-actions.ts` (task + instance reads constrained; sequence/instance ops validate scope)
  - Analytics: `actions/analytics-actions.ts` now constrains counts/group-bys/message stats + “top clients” to accessible `clientId`s
- **Primary write paths now validate scope**
  - Messaging/drafts/sync: `actions/message-actions.ts` now enforces lead/workspace access for send/sync/draft actions and restricts bulk operations to admins.
  - Campaign linking: `actions/campaign-actions.ts` + `actions/email-campaign-actions.ts` now enforce lead access and prevent cross-workspace linking.
  - Workspace settings + knowledge assets + calendar links: `actions/settings-actions.ts` now enforces workspace scope (and prevents cross-workspace calendar link mutations).
  - Reactivations: `actions/reactivation-actions.ts` now requires workspace admin access for campaign/enrollment operations.
- **Admin-only gates added where appropriate (without breaking existing owner-admin model)**
  - Workspace create/update/delete + integration credentials: `actions/client-actions.ts` requires “global admin” (existing owner accounts continue to work).
  - Follow-up sequence template CRUD and default-sequence creation: `actions/followup-sequence-actions.ts` requires workspace admin.
- **API route safety**
  - `app/api/export/leads/route.ts` now requires authenticated, scoped access to the provided `clientId` (prevents unauthenticated bulk export across workspaces).

## Handoff
Phase 1c adds admin UX to manage assignments during onboarding and in Settings → Integrations using the access rules from this phase.
