# Phase 1 — Setter Logins & Client Management

## Purpose
Enable setter-level logins so setters can sign in and manage **only their assigned client workspaces**, while admins retain full visibility and control.

## Context
- Today, each `Client` workspace is tied to a single Supabase Auth `userId` (owner). This works for “one admin owns everything” but does not support “many setters each see a subset”.
- We need a clear mapping of **which clients belong to each setter**. Jon Ferolin manages other setters and also has his own clients; he needs a dedicated login for *his* clients while keeping his existing admin access for overseeing everything.
- Client onboarding must support assigning **setter(s) / inbox manager(s)** at creation time and editing those assignments later in the UI (Settings → Integrations tab).
- Provisioning automation (webhook → `POST /api/admin/workspaces`) should accept an **Inbox Manager email** field for automatic assignment when new clients are added.
- Add **search/navigation** to quickly find client workspaces across the dashboard.
- Scope note: this phase delivers the *setter login + client assignment* system for the current ZRG operation. Multi-agency white-label portals and a platform-wide super-admin remain planned for a later phase and should not be marked “done” by completing this phase.

## Objectives
* [x] Design and store a durable mapping of users ↔ clients (setter/inbox-manager roles)
* [x] Enforce authorization so setters only see assigned clients (UI + server actions + API routes)
* [x] Add admin UX to assign clients to setters/inbox managers during onboarding and in Settings → Integrations
* [x] Accept Inbox Manager email in provisioning automation and auto-assign correctly
* [x] Improve workspace navigation with search/filtering at scale

## Constraints
- Keep existing admin behavior intact (admin can see/manage all client workspaces).
- Use Supabase Auth for identities; never store passwords in Prisma.
- Validate admin/cron secrets before reading request bodies (follow existing patterns in `app/api/admin/*` and `app/api/cron/*`).
- Webhooks are untrusted input: validate + sanitize; do not create privilege escalation paths via email fields.
- Any Prisma schema change requires `npm run db:push` against the correct database.
- Don’t block the future roadmap:
  - Multi-agency “white label” portals (multiple top-level orgs/agencies)
  - A platform “super-super admin” that can manage all agencies and impersonate/switch into each

## Success Criteria
- [x] A setter can log in and only sees assigned client workspaces across the dashboard.
- [x] Admin can create/update client assignments (setter/inbox manager) during workspace creation and later in Settings → Integrations.
- [x] Jon’s dedicated login sees only his client list; his existing admin account still sees all clients and can manage other setters. (Configure by assigning Jon’s setter user to the relevant workspaces.)
- [x] Provisioning automation supports Inbox Manager email and assigns the correct user without manual intervention.
- [x] Workspace navigation supports fast search/filtering for admins managing many client workspaces. (Currently searches by workspace name + GHL Location ID.)

## Phase Summary
- Added a durable user↔workspace assignment model via `ClientMember` (`prisma/schema.prisma`).
- Centralized workspace/lead authorization in `lib/workspace-access.ts` and applied it across core server actions (Inbox/CRM/Follow-ups/Analytics/Messaging/Settings) so “All Workspaces” scopes to assigned workspaces.
- Shipped admin-only assignment UX in `components/dashboard/settings/integrations-manager.tsx` (setters/inbox managers by email; resolves to Supabase userIds server-side).
- Extended provisioning automation to accept `inboxManagerEmail` and persist `ClientMember(role=INBOX_MANAGER)` in `app/api/admin/workspaces/route.ts`.
- Added workspace search to the sidebar workspace picker in `components/dashboard/sidebar.tsx`.

## Subphase Index
* a — Data model + roles design
* b — Authorization enforcement (setter vs admin)
* c — Admin onboarding + Integrations UI for assignments
* d — Provisioning/webhook auto-assignment by inbox manager email
* e — Workspace search + verification checklist
