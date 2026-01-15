# Phase 23 — Workspace Bootstrap + White-Label Branding

## Purpose
Enable creating a brand-new workspace (e.g., “Founders Club”) with an admin login and no connected accounts, via an authenticated admin API endpoint.

## Context
We need a repeatable way to spin up “empty” workspaces for white-label deployments. Today, provisioning is integration-first; this phase adds an admin bootstrap path that can create the workspace, create (or attach) an admin user, and set workspace branding (name + logo) before any inbox accounts are connected.

## Objectives
* [ ] Add an authenticated bootstrap API endpoint for creating/upserting workspace + admin user
* [ ] Support empty workspaces (no integrations required) in schema and UI
* [ ] Document curl examples for local + live usage
* [ ] Ship changes to GitHub

## Constraints
- Never commit secrets, tokens, or real credentials.
- Validate secrets before reading request bodies in admin routes.
- If Prisma schema changes: run `npm run db:push` before considering the phase done.
- Keep UI consistent; do not expose existing private keys in the UI.

## Success Criteria
- [ ] `POST /api/admin/workspaces/bootstrap` can create a workspace + admin user (or attach existing user) with branding and no connected accounts.
- [x] Dashboard renders “connect accounts” guidance when a workspace has no connected accounts.
- [x] `README.md` documents local + production curl usage and required env vars.
- [x] Changes are committed and pushed to GitHub.

Note: the endpoint is implemented and builds, but still needs a live smoke test by calling it with a real `WORKSPACE_PROVISIONING_SECRET` against the deployed app.

## Subphase Index
* a — Define bootstrap contract and auth
* b — Implement backend (schema + route)
* c — Update UI for branding and empty-state
* d — Document, verify, and ship

## Phase Summary
- Added `POST /api/admin/workspaces/bootstrap` to create an empty workspace + optional admin user (`app/api/admin/workspaces/bootstrap/route.ts`).
- Updated Prisma schema to allow empty workspaces and store branding (`prisma/schema.prisma`).
- Wired branding + “no connected accounts” UX into the dashboard (`actions/client-actions.ts`, `components/dashboard/sidebar.tsx`, `components/dashboard/inbox-view.tsx`).
- Documented local + production provisioning cURL in `README.md`.
