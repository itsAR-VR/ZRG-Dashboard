# Phase 19a — Provider Selection + Workspace Safety

## Focus
Implement strict per-workspace single-select email provider configuration without breaking existing workspaces.

## Inputs
- Existing EmailBison integration patterns (`actions/*`, `app/api/webhooks/email/route.ts`)
- Prisma schema: `Client.emailProvider` + provider credential fields

## Work
- Add a resolver that determines the active email provider from explicit `Client.emailProvider` or inferred credentials.
- Enforce single-select in server write paths (Server Actions + admin provisioning API).
- Ensure “touched” semantics so unrelated workspace updates do not wipe existing email credentials.
- Prevent secrets from being returned to the browser (UI should get boolean “has credential” flags).

## Output
- Added provider resolver and single-select enforcement:
  - `lib/email-integration.ts` resolves provider (explicit or inferred) and throws on multi-provider configuration.
  - `actions/client-actions.ts` enforces exclusivity on create/update and returns only `has*` booleans (no secret leakage).
  - `app/api/admin/workspaces/route.ts` supports `emailProvider` + SmartLead/Instantly fields with “touched” semantics, and no longer clears `unipileAccountId` unless explicitly provided.

## Handoff
- Proceed to Phase 19b to wire outbound replies + campaign sync parity for SmartLead/Instantly (EmailBison behavior preserved).

## Handoff
(fill in during execution)
