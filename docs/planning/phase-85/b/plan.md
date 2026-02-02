# Phase 85b — Provisioning: Admin Create/Attach Client Portal User + Email Login Details

## Focus
Provide an admin-only workflow to create (or attach) a Supabase Auth user for a client email, add `CLIENT_PORTAL` membership to a workspace, set an initial password, and email login details.

## Inputs
- Phase 85a role + capabilities helper
- Supabase admin client utilities: `lib/supabase/admin.ts`
- Email sending utility: `lib/resend-email.ts` (supports workspace overrides with env fallback)

## Work
1. **Server actions**
   - Create `actions/client-portal-user-actions.ts` with:
     - `createClientPortalUser(clientId, email, opts?)`
     - `resetClientPortalPassword(clientId, emailOrUserId)`
     - `removeClientPortalAccess(clientId, userId)`
   - Guard with `requireClientAdminAccess(clientId)` (workspace admin only).
2. **User creation / password set**
   - Resolve existing Supabase user by email; create if missing.
   - Generate a strong random password by default (optionally allow admin-provided override).
   - Set `email_confirm: true` on create (so login works immediately).
3. **Membership attach**
   - Create `ClientMember(clientId, userId, role=CLIENT_PORTAL)` idempotently (handle `P2002`).
4. **Email**
   - Send an email with:
     - login URL: `${NEXT_PUBLIC_APP_URL}/auth/login`
     - email + initial password
     - “Use Forgot Password to set your own password”
     - “Mobile app uses the same credentials” (future note)
   - Use `sendResendEmail()` with `Client.resendApiKey`/`Client.resendFromEmail` if present; otherwise fall back to `RESEND_API_KEY`/`RESEND_FROM_EMAIL` env.
   - Never store the password; only return once to caller for immediate email composition.
5. **Admin UI**
   - Add a section in Settings (Team tab recommended) to:
     - list client portal members for the workspace
     - create new client portal user by email
     - reset password (re-send email)
     - remove access

## Output
- Added `actions/client-portal-user-actions.ts` with list/create/reset/remove flows, Supabase admin integration, and Resend email delivery.
- Added `components/dashboard/settings/client-portal-users-manager.tsx` to manage client portal users in Settings → Team.
- Wired `ClientPortalUsersManager` into `components/dashboard/settings-view.tsx` Team tab.
- Email delivery uses workspace Resend config with env fallback and sends login URL + temporary password.

## Coordination Notes
**Potential conflicts:** `components/dashboard/settings-view.tsx` has in-flight changes from other phases (83/84/89). Re-read current file state before merging further edits.
**Files affected:** `actions/client-portal-user-actions.ts`, `components/dashboard/settings/client-portal-users-manager.tsx`, `components/dashboard/settings-view.tsx`.

## Handoff
Proceed to **Phase 85c** to enforce server-side restrictions for client portal users (read-only settings + prompt/cost gating).
