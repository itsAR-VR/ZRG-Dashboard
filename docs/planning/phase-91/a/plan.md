# Phase 91a — Server Action: Provision Workspace Member

## Focus
Add a server action that (1) creates a Supabase Auth user if the email is missing and (2) creates a `ClientMember` role row (`SETTER` or `INBOX_MANAGER`) for the active workspace.

## Inputs
- Supabase Admin helpers: `lib/supabase/admin.ts`
- Existing provisioning helpers: `actions/client-portal-user-actions.ts` (lines 24-74)
- Workspace admin enforcement: `requireClientAdminAccess()` in `lib/workspace-access.ts:59`
- Membership model: `ClientMember` with roles in Prisma schema

## Work

### Step 1: Extract shared helpers
Create `lib/user-provisioning-helpers.ts` with the following functions (extracted from `client-portal-user-actions.ts`):
```typescript
export function normalizeEmail(input: string): string;
export function isValidEmail(value: string): boolean;
export function generateTemporaryPassword(): string;
export function buildLoginEmailText(opts: { appUrl: string; brand: string; email: string; password: string }): string;
export async function getWorkspaceEmailConfig(clientId: string): Promise<EmailConfig>;
export function hasResendConfig(config: EmailConfig): boolean;
```

Update `client-portal-user-actions.ts` to import from the new helper file instead of duplicating.

### Step 2: Create the action module
Create `actions/workspace-member-provisioning-actions.ts` with `"use server"` directive.

### Step 3: Implement `provisionWorkspaceMember(clientId, input)`

```typescript
export async function provisionWorkspaceMember(
  clientId: string,
  input: { email: string; role: "SETTER" | "INBOX_MANAGER" }
): Promise<{
  success: boolean;
  userExisted: boolean;
  membershipCreated: boolean;
  emailSent: boolean;
  userId?: string;
  error?: string;
}>
```

Implementation logic:
1. `await requireClientAdminAccess(clientId)` — admin check
2. Validate role is `SETTER` or `INBOX_MANAGER` only (reject others)
3. `normalizeEmail(input.email)` + `isValidEmail()` validation
4. `resolveSupabaseUserIdByEmail(email)` to check existence
5. **If user does NOT exist:**
   - Check `hasResendConfig()` — fail early if email can't be sent
   - `generateTemporaryPassword()`
   - `createSupabaseAdminClient().auth.admin.createUser({ email, password, email_confirm: true })`
   - `sendResendEmail()` with login details
   - Set `userExisted = false`, `emailSent = true`
6. **If user DOES exist:**
   - Set `userExisted = true`, `emailSent = false`
   - Do NOT reset password; do NOT send email
7. Create membership:
   ```typescript
   try {
     await prisma.clientMember.create({
       data: { clientId, userId, role: ClientMemberRole[input.role] },
     });
     membershipCreated = true;
   } catch (error) {
     if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
       membershipCreated = false; // Idempotent: already exists
     } else {
       throw error;
     }
   }
   ```
8. Return result (NEVER include password in response)

## Validation (RED TEAM)

1. **Verify helper extraction:**
   - `lib/user-provisioning-helpers.ts` exports all listed functions
   - `client-portal-user-actions.ts` imports from the new file (no duplication)

2. **Verify action behavior:**
   - Admin check happens first
   - Invalid role rejects with clear error
   - New user: creates Auth user + sends email + creates membership
   - Existing user: creates membership only (no password change, no email)
   - P2002 (duplicate membership) is handled gracefully

3. **Verify password never returned:**
   - Response type does not include `password`
   - No `console.log(password)` anywhere

## Output
- `lib/user-provisioning-helpers.ts` — shared email/credential helpers extracted from client-portal flow.
- `actions/client-portal-user-actions.ts` now imports shared helpers (no duplicate implementations).
- `actions/workspace-member-provisioning-actions.ts` added:
  - `provisionWorkspaceMemberCore()` for dependency-injected testing
  - `provisionWorkspaceMember()` server action for UI use
  - Strict role gating to `SETTER` / `INBOX_MANAGER`
  - Resend checks + email send only for newly created auth users

## Coordination Notes
No conflicts detected; Phase 85 patterns reused for email/password generation and Resend config handling.

## Handoff
Proceed to Phase 91b to add a Team-tab UI surface that calls this action and reports status/errors clearly.
