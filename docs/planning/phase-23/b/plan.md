# Phase 23b — Implement backend (schema + route)

## Focus
Implement the provisioning endpoint and any schema changes required to create an empty workspace with branding and an admin user.

## Inputs
- Contract decisions from `docs/planning/phase-23/a/plan.md`
- Prisma schema in `prisma/schema.prisma`
- Supabase admin helpers in `lib/supabase/*`

## Work
- Prisma schema:
  - Make GHL integration fields nullable to support empty workspaces.
  - Add `WorkspaceSettings.brandName` + `WorkspaceSettings.brandLogoUrl`.
- API route implementation:
  - Add `POST /api/admin/workspaces/bootstrap` with secret validation before reading request body.
  - Create/get Supabase Auth user with service role:
    - Create user requires `adminPassword`
    - Password reset allowed only when `upsert=true`
  - Create/get workspace (Prisma `Client`) with `ghlLocationId=null` / `ghlPrivateKey=null`.
  - Upsert `WorkspaceSettings` for branding fields.
  - Ensure a default `ReactivationCampaign` exists for brand-new workspaces.

## Output
- Updated Prisma schema to support “empty” workspaces + branding:
  - `prisma/schema.prisma`:
    - `Client.ghlLocationId` is now nullable (`String? @unique`)
    - `Client.ghlPrivateKey` is now nullable (`String?`)
    - `WorkspaceSettings.brandName` + `WorkspaceSettings.brandLogoUrl` added
- Added authenticated bootstrap endpoint:
  - `app/api/admin/workspaces/bootstrap/route.ts`
  - Validates `WORKSPACE_PROVISIONING_SECRET` (or server-side fallback) before reading JSON body
  - Creates/updates Supabase Auth user (service role) and creates/updates the workspace + settings in a Prisma transaction
  - Creates a default `ReactivationCampaign` when missing

## Handoff
Proceed to Phase 23c to ensure the UI handles empty workspaces and displays branding.
