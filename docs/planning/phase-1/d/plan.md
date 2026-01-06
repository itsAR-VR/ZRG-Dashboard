# Phase 1d — Provisioning/Webhook Auto-Assignment by Inbox Manager Email

## Focus
Support automation-driven client onboarding where a provisioning payload includes an Inbox Manager email, and the system assigns the correct setter/inbox manager automatically.

## Inputs
- Phase 1a decision for how assignments are stored (userId-backed)
- Phase 1b access rules and utilities (no privilege escalation via email)
- Existing provisioning endpoint: `app/api/admin/workspaces/route.ts`

## Work
- Extend the provisioning request contract to include assignment fields:
  - `inboxManagerEmail` (and/or `setterEmail`) as inputs
  - Resolve to userId using Supabase Admin APIs server-side (service role only)
  - Store assignment in Prisma using Phase 1a model
- Define failure behavior for unknown emails:
  - Reject with a clear 4xx error, or
  - Create workspace but leave unassigned (only if safe), plus an alert/log
- Add idempotency/upsert considerations:
  - When `upsert=true`, decide whether assignment updates are allowed and how conflicts are handled
- Ensure secrets are validated before reading request body (keep existing route pattern)

## Output
- Provisioning endpoint now supports inbox manager auto-assignment:
  - `app/api/admin/workspaces/route.ts` accepts optional `inboxManagerEmail`
  - Email is resolved server-side via Supabase Admin APIs (service role) and stored as a `ClientMember` row with role `INBOX_MANAGER`
  - On `upsert=true`, providing `inboxManagerEmail` replaces prior `INBOX_MANAGER` assignments for that workspace (idempotent)
- Safe-by-default behavior:
  - Endpoint remains protected by `WORKSPACE_PROVISIONING_SECRET` (validated before reading body)
  - Unknown `inboxManagerEmail` fails with a clear 4xx error (no implicit access grants)

## Handoff
Phase 1e adds search/navigation improvements and documents a verification checklist to validate end-to-end setter login behavior.
