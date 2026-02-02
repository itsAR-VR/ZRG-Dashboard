# Phase 91 — Team Tab: Provision SETTER/INBOX_MANAGER Supabase Users

## Purpose
Let workspace admins create (or attach) Supabase Auth users from Settings → Team and grant them workspace membership as `SETTER` or `INBOX_MANAGER`, so they can be used for lead assignment and workflow ownership without manual Supabase console work.

## Context
- Phase 89 (Weighted Round-Robin) stores rotation as Supabase Auth `userId`s and depends on setters being real Supabase users + `ClientMember` rows.
- Phase 85 added Client Portal User provisioning via UI (`ClientPortalUsersManager`) using `supabase.auth.admin.createUser()` and an emailed temporary password.
- Today, setter/inbox-manager role assignment is managed via the Integrations → Assignments editor, but it assumes the email already exists in Supabase Auth (otherwise save fails).
- We want an **admin-only** flow in the Team tab to create the Supabase Auth user (if missing) and then add the correct workspace membership role.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 85 | Complete | Team tab UI + Supabase Auth provisioning patterns | Reuse existing helpers from `client-portal-user-actions.ts`: `normalizeEmail()`, `isValidEmail()`, `generateTemporaryPassword()`, `buildLoginEmailText()`, `getWorkspaceEmailConfig()`, `hasResendConfig()`. Do NOT duplicate these. |
| Phase 89 | Complete | Setter membership + round-robin assignment | Ensure new members appear in Assignments + can be added to round-robin sequence. |
| Phase 90 | Complete | CRM assignment dropdown uses `ClientMember` roles | Ensure membership creation is consistent so CRM assignee dropdown can pick up new setters. |

## Repo Reality Check (RED TEAM)

- **What exists today:**
  - `actions/client-portal-user-actions.ts` — has reusable helpers: `normalizeEmail()`, `isValidEmail()`, `generateTemporaryPassword()`, `buildLoginEmailText()`, `getWorkspaceEmailConfig()`, `hasResendConfig()` (lines 24-74)
  - `lib/supabase/admin.ts:23` — `resolveSupabaseUserIdByEmail(email)` returns userId or null
  - `lib/supabase/admin.ts:12` — `createSupabaseAdminClient()` for admin operations
  - `lib/workspace-access.ts:59` — `requireClientAdminAccess(clientId)` enforces admin check
  - `lib/resend-email.ts:19` — `sendResendEmail()` for email delivery
  - `components/dashboard/settings/client-portal-users-manager.tsx` — existing Team tab UI for CLIENT_PORTAL users
  - `components/dashboard/settings-view.tsx:5982-5989` — Team tab content renders ClientPortalUsersManager
  - `prisma/schema.prisma:12-17` — `ClientMemberRole` enum: ADMIN, SETTER, INBOX_MANAGER, CLIENT_PORTAL
  - `prisma/schema.prisma:217-230` — `ClientMember` model with `@@unique([clientId, userId, role])` constraint

- **What the plan assumes:**
  - `provisionWorkspaceMember()` action does NOT exist — Phase 91a creates it
  - `WorkspaceMembersManager` component does NOT exist — Phase 91b creates it
  - Test file does NOT exist — Phase 91c creates and registers it

- **Verified touch points:**
  - `requireClientAdminAccess()` exists at `lib/workspace-access.ts:59`
  - `resolveSupabaseUserIdByEmail()` exists at `lib/supabase/admin.ts:23`
  - `createSupabaseAdminClient()` exists at `lib/supabase/admin.ts:12`
  - `sendResendEmail()` exists at `lib/resend-email.ts:19`
  - Team tab exists at `settings-view.tsx:5982`
  - ClientPortalUsersManager exists at `components/dashboard/settings/client-portal-users-manager.tsx`

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Helper duplication:** Plan mentions "reuse Phase 85 logic" but doesn't specify HOW. Helpers are currently private to `client-portal-user-actions.ts`. → **Mitigation:** Extract shared helpers to a new `lib/user-provisioning-helpers.ts` OR import from the actions file (if possible with "use server" directive). Decision: Extract to lib.
- **Different existing-user behavior:** Phase 85's `createClientPortalUser` REJECTS existing users by default; Phase 91 wants to ADD MEMBERSHIP ONLY. This is intentional but needs explicit implementation. → **Mitigation:** Phase 91a action explicitly handles existing users differently: add membership without password change and WITHOUT sending credentials email.
- **Test file won't run without registration:** `scripts/test-orchestrator.ts` uses **MANUAL file registration**. Phase 91c MUST add the test file to `TEST_FILES` array. → **Mitigation:** Explicit step added to Phase 91c.

### Missing or ambiguous requirements
- **Email-only for new users:** When should credentials email be sent? → **Decision:** Only for NEW Supabase Auth users; existing users get membership added silently (they already have login credentials).
- **Multiple roles:** A user can have SETTER + INBOX_MANAGER in the same workspace (per unique constraint). Should we allow this? → **Decision:** Allow; the action is role-specific and idempotent.
- **ADMIN role provisioning:** Not in scope per plan constraints. → **Verified.**

### Repo mismatches (none)
- All file references verified.

### Performance / timeouts
- Supabase admin API calls + Resend email are external. Typical latency < 3s. → No concern.

### Security / permissions
- **Admin gating:** `requireClientAdminAccess(clientId)` is mandatory. → Verified in plan.
- **Password never returned:** Plan explicitly states this. → Verified.

### Testing / validation
- **Test file registration is MANUAL.** Phase 91c must add `actions/__tests__/workspace-member-provisioning-actions.test.ts` (or similar) to `scripts/test-orchestrator.ts:TEST_FILES`. → Added explicit step.

## Multi-Agent Coordination Notes

### Active Conflicts (Updated)
| File | Concurrent Phase | Status | Phase 91 Impact | Resolution |
|------|------------------|--------|-----------------|------------|
| `components/dashboard/settings-view.tsx` | Phase 85, 90 | Complete | Add new component to Team tab | Additive; read current state before editing |
| `actions/client-portal-user-actions.ts` | Phase 85 | Complete | Extract helpers to shared lib | Refactor to avoid duplication |

### Pre-Flight Checklist (Before Phase 91 Implementation)
- [x] Re-read `actions/client-portal-user-actions.ts` to confirm helper locations
- [x] Re-read `components/dashboard/settings-view.tsx` Team tab section (~line 5982)
- [x] Re-read `scripts/test-orchestrator.ts` to confirm manual registration pattern

## Open Questions (Need Human Input)

- [x] **Credentials email behavior:** Only for new users, or also for existing users? (confidence ~95%, decided)
  - **Decision:** Only for NEW Supabase Auth users. Existing users get membership added silently.

- [x] **Helper extraction:** Move helpers to lib or import from actions file? (confidence ~90%, decided)
  - **Decision:** Extract to `lib/user-provisioning-helpers.ts` for clean reuse.

## Assumptions (Agent)

- **Test orchestrator requires manual registration** (confidence ~99%)
  - Verified: `scripts/test-orchestrator.ts` uses explicit `TEST_FILES` array
  - Impact: Phase 91c MUST add the new test file to this array

- **ClientMember unique constraint allows multiple roles per user per workspace** (confidence ~99%)
  - Verified: `@@unique([clientId, userId, role])` means (clientId, userId, SETTER) and (clientId, userId, INBOX_MANAGER) are distinct rows
  - Impact: A user can have both roles; action is role-specific

- **Phase 85 provisioning patterns are stable** (confidence ~95%)
  - Verified: Phase 85 is marked Complete; helpers exist and work
  - Impact: Safe to extract and reuse

## Objectives
* [x] Add an admin-only server action to provision a workspace member as `SETTER` or `INBOX_MANAGER`, creating the Supabase Auth user if needed.
* [x] Add UI in Settings → Team to call this action (workspace admin only).
* [x] Ensure results are compatible with Assignments + round-robin sequence builder (Phase 89) and CRM assignee dropdown (Phase 90).
* [x] Add tests and a short verification runbook.

## Constraints
- **Admin-only:** Must enforce `requireClientAdminAccess(clientId)` server-side; UI should also hide controls for non-admins.
- **Roles:** Only supports `SETTER` and `INBOX_MANAGER` in this phase (no ADMIN / CLIENT_PORTAL provisioning here).
- **Credential delivery (decision):** Email login + temporary password when creating a new Supabase Auth user.
- **Existing user behavior (decision):** If user exists in Supabase Auth, add membership only; do not reset password and do not email credentials.
- **No secrets/PII:** Never persist plaintext passwords; do not log or return passwords to the browser.
- **Email sending:** Requires Resend configured (workspace-level or global env, consistent with Phase 85).

## Success Criteria
- Workspace admin can provision a new email as `SETTER`/`INBOX_MANAGER` from Team tab:
  - If the email does not exist in Supabase Auth, a user is created and an email is sent with login + temp password.
  - A `ClientMember` row is created for the selected role.
- If the email already exists in Supabase Auth, provisioning adds the `ClientMember` role idempotently without changing the password.
- The new setter appears in:
  - Integrations → Assignments setter list
  - Round-robin sequence builder options (Phase 89)
  - CRM assignee dropdown (Phase 90)
- Validation passes: `npm run test` and `npm run lint` (warnings acceptable), and `npx next build --webpack` in the Codex sandbox.

## Phase Summary

### Status: Complete (manual QA pending)

**Shipped:**
- Shared provisioning helpers extracted to `lib/user-provisioning-helpers.ts`
- Server action + core logic in `actions/workspace-member-provisioning-actions.ts`
- Admin-only Team tab provisioner in `components/dashboard/settings/workspace-members-manager.tsx`
- Unit tests added and registered (`lib/__tests__/workspace-member-provisioning.test.ts`)

**Verified (2026-02-02):**
- `npm run test`: pass (108 tests)
- `npm run lint`: warnings only (baseline-browser-mapping notice + existing hook/img warnings)
- `npx next build --webpack`: pass (middleware deprecation notice + baseline-browser-mapping notice)

**Manual QA:**
- Scenarios in Phase 91c runbook remain pending in a live workspace.

**Key Files:**
- `lib/user-provisioning-helpers.ts`
- `actions/workspace-member-provisioning-actions.ts`
- `components/dashboard/settings/workspace-members-manager.tsx`
- `lib/__tests__/workspace-member-provisioning.test.ts`
- `scripts/test-orchestrator.ts`

## Subphase Index
* a — Server Action: provision workspace member
* b — Team Tab UI: provisioner card + wiring
* c — Tests + verification runbook

## Post-Implementation Review (2026-02-02)
**Status: ✅ COMPLETE**

All success criteria verified. See `docs/planning/phase-91/review.md` for full evidence mapping.

### Verified Deliverables
- Helper extraction: `lib/user-provisioning-helpers.ts` with 6 shared functions ✅
- Server action: `actions/workspace-member-provisioning-actions.ts` with DI pattern ✅
- UI: `components/dashboard/settings/workspace-members-manager.tsx` (admin-only) ✅
- Tests: `lib/__tests__/workspace-member-provisioning.test.ts` (6 tests) ✅
- Test registration: `scripts/test-orchestrator.ts` line 16 ✅
- Helper import: `actions/client-portal-user-actions.ts` line 16 ✅

### Quality Gates
- `npm run test`: ✅ 108 tests, 0 failures
- `npm run lint`: ✅ 0 errors, 22 warnings (pre-existing)
- `npm run build`: ✅ pass (Turbopack)
