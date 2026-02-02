# Phase 85e — Future Onboarding: Stripe-Ready Architecture Plan (Auth + Onboarding Flow)

## Focus
Ensure today’s client portal implementation does not block a future self-serve flow where a client signs up (post-Stripe), creates their own account, and completes onboarding (website/assets → knowledge/personality inputs).

## Inputs
- Phase 85 core design (client users are standard Supabase Auth users + `ClientMember` membership)
- Existing auth routes under `app/auth/*` (email/password + Google OAuth)
- Existing workspace provisioning patterns under `app/api/admin/workspaces/*`

## Work
1. **Define onboarding data separation**
   - Plan a dedicated onboarding model (future schema) to store client-provided inputs without granting direct edit access to locked `WorkspaceSettings`.
   - Example future tables (planning only for this phase):
     - `WorkspaceOnboarding` (status + timestamps)
     - `WorkspaceOnboardingSubmission` (website URL, assets, brand info, etc.)
2. **Define self-serve flow contract**
   - Stripe checkout success → create workspace + owner user membership
   - Redirect to `/onboarding` to collect inputs
   - After completion, inputs are either:
     - promoted into locked settings by admins, or
     - referenced at runtime for drafting (without exposing prompt editing)
3. **Auth compatibility**
   - Confirm Google OAuth remains supported (already present in login UI), with Supabase provider configuration as deployment work.
   - Ensure mobile uses the same Supabase email/password credentials.
4. **Document required env/config**
   - Enumerate future env vars (Stripe keys, webhook secrets, redirect URLs, etc.) in a planning note (no secrets committed).

## Output
- **Self-serve flow contract:** Stripe Checkout success → webhook creates `Client` + `ClientMember` with `CLIENT_PORTAL` role, then redirects to `/onboarding` for data collection (no direct settings edits).
- **Data separation:** Onboarding inputs live in a dedicated future model (`WorkspaceOnboarding`, `WorkspaceOnboardingSubmission`) and never write directly to `WorkspaceSettings`; promotion to settings is done by admins or a controlled internal job.
- **Auth compatibility:** Supabase email/password remains primary; Google OAuth is supported via Supabase provider config (deployment-only). Mobile app uses the same credentials.
- **API sketch (planning):** `POST /api/stripe/webhook` (create workspace + user membership), `POST /api/onboarding/submit` (store inputs), `GET /api/onboarding/status` (client-facing progress).
- **Env/config planning:** Stripe keys + webhook secret + redirect URLs to be documented later (no secrets committed).

## Handoff
Implementation of Stripe/onboarding is deferred to a future phase; Phase 85f should update README with a short note about planned onboarding architecture.
