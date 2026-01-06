# Phase 1a — Data Model + Roles Design

## Focus
Define how “setters / inbox managers” are represented in the system and how client workspaces are assigned to them, in a way that supports today’s needs without blocking the future multi-agency roadmap.

## Inputs
- Current Prisma models, especially `Client.userId` ownership (`prisma/schema.prisma`)
- Current “owned-by-userId” access pattern in server actions (e.g., `actions/client-actions.ts`)
- Roadmap note: future multi-agency white-label portals + platform super-admin

## Work
- Decide the minimal durable representation for assignments:
  - **Option A (recommended):** add a join table (e.g., `ClientMember` / `ClientAccess`) with `clientId`, `userId`, `role` (`admin` | `setter` | `inbox_manager`), plus uniqueness rules.
  - **Option B:** add columns on `Client` (e.g., `assignedSetterUserId`, `inboxManagerUserId`) for the first iteration.
- Define role semantics:
  - Admin: full access (likely via ownership or an explicit admin role)
  - Setter: read/write only for assigned clients (inbox actions, follow-ups, drafts, etc.)
  - Inbox Manager: if distinct from setter, define whether it is a permission set or just a “default assignee” label
- Define identity lookup strategy for assignments by email:
  - Store **userId** in Prisma (authoritative), and accept email only for *lookup* at provisioning time.
  - Decide what happens if the email doesn’t match an existing user (reject vs. leave unassigned vs. queue an invite).
- Plan for initial mapping/backfill:
  - How we’ll import “which clients belong to which setter” (manual admin UI, script, CSV, or Monday export).
- Produce a migration approach:
  - Schema update(s) in `prisma/schema.prisma`
  - `npm run db:push`
  - Minimal backfill script if required

## Output
- **Decision (Option A):** Use a join table for user ↔ client assignments so a user can be assigned to many clients and a client can have multiple assigned users, without hardcoding setter/inbox-manager columns on `Client`.
- **Role semantics**
  - **Workspace Owner (existing `Client.userId`)**: treated as “workspace admin” (full access) and remains the source-of-truth for the current ZRG single-agency operation.
  - **`ClientMemberRole.ADMIN`**: optional additional per-workspace admin membership (useful if we need more than one admin account later).
  - **`ClientMemberRole.SETTER`**: can access only assigned clients; can perform normal inbox/CRM/follow-up work within those clients.
  - **`ClientMemberRole.INBOX_MANAGER`**: same access scope as setter for now; used as a durable label for automation + UI assignment (can diverge later if permissioning needs differ).
- **Identity lookup strategy**
  - Persist **Supabase Auth `userId`** in Prisma for assignments.
  - Accept **email only as a lookup input** (provisioning/UI), resolved server-side via Supabase Admin APIs; if no matching user exists, the operation should fail safe (no implicit access grants).
- **Schema changes**
  - Added `enum ClientMemberRole { ADMIN SETTER INBOX_MANAGER }`
  - Added `model ClientMember` with:
    - `clientId`, `userId`, `role`
    - `@@unique([clientId, userId, role])` to allow multiple roles per user per client while preventing duplicates
    - `@@index([userId])`, `@@index([clientId])` for fast “which clients can this user access?” lookups
  - Added `Client.members` relation
  - Source: `prisma/schema.prisma`

## Handoff
Phase 1b updates server actions + UI/workspace listing to use `Client.userId` OR `ClientMember` assignments for access control, with explicit “admin-only” gating for sensitive operations.
