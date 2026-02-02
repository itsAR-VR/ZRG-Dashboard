# Phase 85 — Client Portal Users (Client Logins + Read-Only Settings + Hide Prompts/Cost)

## Purpose
Enable clients to be provisioned as Supabase Auth users who can log in to ZRG Dashboard (web now; mobile later) and access only their workspace, with a simplified experience: Inbox + drafting + CRM as primary, Settings visible but read-only, and no access to prompt/cost internals.

## Context
- The app already uses Supabase Auth (email/password + Google OAuth UI) and enforces workspace access via Prisma scoping in `lib/workspace-access.ts`.
- Workspaces are `Client` records, owned by `Client.userId` (Supabase Auth user ID). Additional memberships exist via `ClientMember` with roles (`ADMIN`, `INBOX_MANAGER`, `SETTER`).
- We need a new “client portal” role that:
  - can view platform surfaces (Inbox/CRM/etc.) for their workspace
  - cannot change workspace configuration (read-only Settings)
  - cannot edit AI personality/personas
  - cannot see backend prompts, prompt overrides, AI usage/cost/observability
- Provisioning must support:
  - ZRG admin adds the client by email
  - system creates (or attaches) the user, sets an initial password, and emails login details
  - client can later set their own password via “Forgot password”
- Future requirement: self-serve onboarding after Stripe checkout must fit this model without rewriting auth/tenancy (client signs up, pays, onboarding collects website/assets; those become AI inputs under a controlled model).

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 84–89 (working tree) | Uncommitted/untracked | `prisma/schema.prisma`, `components/dashboard/settings-view.tsx` | Reconcile in-flight schema/UI changes before implementing Phase 85; re-read current file state before edits. |
| Phase 1 | Complete | `ClientMember` roles + workspace access patterns | Build on existing membership + auth guard patterns; no parallel RBAC system. |

## Objectives
* [x] Add a dedicated `CLIENT_PORTAL` membership role for client logins
* [x] Add a workspace capabilities helper so UI + server actions consistently enforce restrictions
* [x] Add admin UI + server actions to provision client users and email login details
* [x] Enforce read-only Settings and AI personality immutability for client portal users (server-side)
* [x] Hide prompt templates/overrides and AI cost/observability from client portal users (UI + API)
* [x] Lay groundwork for future Stripe onboarding flow (planning-level structure only)

## Constraints
- Do not store plaintext passwords anywhere; only generate/return one-time for emailing.
- Never commit secrets/tokens/PII; do not add client emails or CRM exports to repo.
- Workspace isolation is enforced server-side (Prisma scoping + auth), not by UI alone.
- Client portal users must not be able to mutate settings by calling server actions directly.

## Success Criteria
- Admin can create a client portal user for a workspace and an email is sent with:
  - login URL for web
  - email + initial password
  - note: mobile app uses same credentials (future)
- Client portal user logs in and sees their workspace Inbox/CRM, including “All Responses”, “Requires Attention”, and drafting/approval UX.
- Client portal user can open Settings but cannot edit anything; all mutation attempts are rejected server-side.
- AI personality/persona editing is disabled/hidden for client portal users.
- Prompt templates/overrides and AI observability/cost views are not visible to client portal users, and all related endpoints remain admin-only.
- `npm run lint`, `npm run test`, and `npm run build` pass after implementation.
  - **Status:** lint/test pass; build fails due to unrelated type error in `components/dashboard/analytics-crm-table.tsx` (missing `rollingMeetingRequestRate` on `CrmSheetRow`).

## Phase Summary

### Status: Complete (build blocked by unrelated issue)

**Shipped:**
- `CLIENT_PORTAL` role + `lib/workspace-capabilities.ts` helper and tests
- Provisioning actions + UI (`actions/client-portal-user-actions.ts`, `components/dashboard/settings/client-portal-users-manager.tsx`)
- Read-only settings enforcement (server-side `requireSettingsWriteAccess()` + UI gating/banners)
- Stripe/onboarding architecture planning (Phase 85e)
- README updated with provisioning + permissions docs

**Verified (2026-02-02):**
- `npm run lint`: Pass (0 errors, 23 warnings)
- `npm run test`: Pass (93/93)
- `npm run build`: Fail (unrelated type error in `analytics-crm-table.tsx` from Phase 83/90)
- `npm run db:push`: Pending (requires env + prior phase schema merges)

**Key Files:**
- `lib/workspace-capabilities.ts` — capabilities helper
- `actions/client-portal-user-actions.ts` — provisioning actions
- `actions/settings-actions.ts` — write gating (17+ endpoints)
- `components/dashboard/settings-view.tsx` — UI read-only mode
- `components/dashboard/settings/client-portal-users-manager.tsx` — admin manager UI

**Follow-ups:**
- Fix `CrmSheetRow.rollingMeetingRequestRate` type error (Phase 83/90)
- Run `npm run db:push` to apply schema changes
- Manual QA per 85f checklist

## Subphase Index
* a — RBAC: schema role + capabilities helper
* b — Provisioning: admin create/attach portal user + email login details
* c — Backend enforcement: block settings/personality edits + keep prompts/cost admin-only
* d — UI: read-only settings mode + hide prompt/cost sections
* e — Future onboarding: Stripe-ready structure (planning)
* f — Verification: tests + QA checklist + docs updates
