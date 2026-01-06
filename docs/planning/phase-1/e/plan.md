# Phase 1e — Workspace Search + Verification Checklist

## Focus
Improve navigation for admins managing many client workspaces and provide a repeatable verification checklist for the entire “setter login + client assignment” flow.

## Inputs
- Phase 1b enforced access patterns (who can see which workspaces)
- Phase 1c UI surfaces for assignments
- Current workspace listing/switching patterns in the dashboard UI

## Work
- Add a scalable workspace navigation UX:
  - Search/filter by workspace name, location ID, assigned setter/inbox manager
  - Admin view: search across all workspaces
  - Setter view: search only within assigned workspaces
- Add/confirm “quick switch” affordances where relevant (sidebar/header/workspace picker)
- Define a verification checklist (minimum smoke test):
  - Admin creates/updates a workspace and assigns setter/inbox manager
  - Setter logs in and sees only assigned clients
  - Setter cannot access admin-only settings/actions
  - Provisioning endpoint assigns by inbox manager email successfully
  - Search works for both admin and setter scopes

## Output
- **Workspace navigation improvement**
  - Added a lightweight search box to the workspace dropdown so admins (and setters) can quickly filter by workspace name or GHL Location ID:
    - `components/dashboard/sidebar.tsx`
- **Verification checklist (minimum smoke test)**
  1. **Admin assignments (UI)**
     - Log in as an admin account.
     - Go to Settings → Integrations.
     - Create a workspace and set `Setter email(s)` + `Inbox manager email(s)` (emails must exist in Supabase Auth).
     - Edit an existing workspace and confirm assignments can be loaded and updated.
  2. **Setter access scope**
     - Log in as a setter account (non-admin).
     - Confirm workspace dropdown shows only assigned workspaces.
     - Confirm Inbox/CRM/Follow-ups/Analytics only show data from assigned workspaces (including “All Workspaces” mode).
     - Confirm setter cannot create/delete workspaces, edit integrations, or run admin-only sync actions.
  3. **Provisioning auto-assignment**
     - Call `POST /api/admin/workspaces` with `upsert=true` and a valid `inboxManagerEmail`.
     - Confirm the workspace is created/updated and `ClientMember(role=INBOX_MANAGER)` is set for the resolved user.
     - Confirm unknown `inboxManagerEmail` fails with a 4xx (no assignment created).
  4. **Regression sanity**
     - Admin account still sees/manages all workspaces it owns (existing behavior preserved).
     - Webhooks continue to ingest messages normally (no change expected).

## Handoff
If successful, the next phase can expand to multi-agency white-label portals and platform super-admin controls without rewriting the setter assignment model.
