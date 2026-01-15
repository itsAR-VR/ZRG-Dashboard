# Phase 23a — Define bootstrap contract and auth

## Focus
Define the API contract for provisioning an “empty” workspace (no inbox accounts/integrations) and an admin user, including authentication and idempotency behavior.

## Inputs
- Current admin provisioning endpoint(s) under `app/api/admin/workspaces/*`
- Existing `Client` + `WorkspaceSettings` data model in `prisma/schema.prisma`
- Existing README onboarding/provisioning sections

## Work
 - Endpoint path: `POST /api/admin/workspaces/bootstrap`.
 - Request shape:
   - `workspaceName` (required)
   - `adminEmail` (required)
   - `adminPassword` (required only if the auth user does not already exist)
   - `upsert` (optional; required for password reset + workspace update behavior)
   - `brandName` / `brandLogoUrl` (optional; stored in `WorkspaceSettings`)
 - Auth mechanism:
   - Preferred: `Authorization: Bearer <WORKSPACE_PROVISIONING_SECRET>`
   - Fallback headers supported for tooling: `x-workspace-provisioning-secret`, `x-admin-secret`, `x-cron-secret`
   - Last-resort (not recommended): `?secret=...` query param
   - Rule: validate secret before reading request body.
 - Idempotency/upsert behavior:
   - If user exists and `adminPassword` is provided: require `upsert=true` to reset password (otherwise 409).
   - If workspace exists for `(userId, workspaceName)` and `upsert` is false: no-op (return 200 with `existedWorkspace=true`).
   - If workspace missing: create it (return 201).
 - Schema impact required:
   - Allow “empty” workspaces by making integration fields nullable (GHL location/key).
   - Add branding fields to settings (brand name + logo URL).

## Output
- Contract captured and implemented:
  - Endpoint: `POST /api/admin/workspaces/bootstrap`
  - Auth: `WORKSPACE_PROVISIONING_SECRET` (with `ADMIN_ACTIONS_SECRET`/`CRON_SECRET` fallback server-side)
  - Workspace branding fields: `brandName`, `brandLogoUrl` (URL path to `public/` asset, e.g. `/images/Founders%20Club%20Logo.svg`)
  - User creation/reset guardrails: no password resets unless `upsert=true`

## Handoff
Proceed to implement schema + route per this contract in Phase 23b.
