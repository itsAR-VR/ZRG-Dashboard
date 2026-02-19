# Phase 173b — Webhook Config Surface + Payload Contract (Workspace Settings Driven)

## Focus
Define and implement the CRM outbound webhook configuration surface in workspace settings, and formalize the outbound payload contract based on existing analytics CRM row logic.

## Inputs
- Prior subphase output: `docs/planning/phase-173/a/plan.md`
- Config and settings paths:
  - `actions/settings-actions.ts`
  - `app/api/admin/workspaces/route.ts`
  - `prisma/schema.prisma` (only if new persistent fields are required)
- CRM mapping source:
  - `actions/analytics-actions.ts` (`getCrmSheetRows`, CRM row mapping logic)
  - `lib/crm-sheet-utils.ts`

## Work
1. Define `crmWebhook` settings shape (workspace-scoped):
  - `enabled`
  - `url`
  - `secret` (write-only/masked on reads)
  - `events` (`lead_created`, `crm_row_updated`)
  - optional operational knobs (`maxRetries`, timeout if needed)
2. Wire settings read/write validation in `actions/settings-actions.ts` with existing capability checks.
3. Enforce egress safety in settings mutations:
  - URL must be `https://`
  - reject localhost and private-network hostnames/IPs
  - normalize and trim URL before persist
4. Extend admin workspace settings whitelist/coercion in `app/api/admin/workspaces/route.ts` for compatibility with provisioning flows.
5. Extract or centralize payload builder logic so outbound webhook payload mirrors analytics CRM row behavior (single contract source).
6. Define event envelope fields (`eventType`, `eventId`, `occurredAt`, `dedupeKey`) and HMAC-signable canonical payload bytes.

## Validation
- Unit/type-level checks for settings normalization and secret masking behavior.
- Unit/type-level checks for URL validation and private-network deny behavior.
- Verify payload contract includes expected CRM fields and stable key names.
- Confirm unauthorized settings writers cannot mutate webhook config.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added workspace-level CRM webhook settings fields in `prisma/schema.prisma`:
    - `crmWebhookEnabled`
    - `crmWebhookUrl`
    - `crmWebhookEvents`
    - `crmWebhookSecret`
  - Extended `UserSettingsData` + `getUserSettings` + `updateUserSettings` in `actions/settings-actions.ts` to support CRM webhook config with:
    - masked/read-safe secret handling (`crmWebhookSecret` returns `null`, `crmWebhookSecretSet` boolean exposed)
    - admin-gated mutation checks
    - enablement validation requiring URL/secret/events when enabled
  - Added shared config normalization helpers in `lib/crm-webhook-config.ts`:
    - HTTPS-only URL enforcement
    - localhost/private-network hostname deny
    - event type normalization/dedupe
  - Updated admin provisioning whitelist/coercion path in `app/api/admin/workspaces/route.ts` for CRM webhook settings support.
  - Extracted shared CRM row payload builder contract in `lib/crm-webhook-payload.ts` and reused it in `actions/analytics-actions.ts` mapping path.
- Commands run:
  - `npm run build` (includes `prisma generate`) — pass.
  - `npm run lint` — pass (warnings only, no errors).
- Blockers:
  - None.
- Next concrete steps:
  - Wire enqueue triggers in `lead-crm-row` and `updateCrmSheetCell` (`173c`).

## Output
- Workspace settings contract for CRM webhook is implemented across Prisma + settings actions + admin provisioning coercion.
- Shared CRM payload contract now has a single mapping source in `lib/crm-webhook-payload.ts`, and analytics CRM rows reuse it.

## Handoff
Proceed to **173c** to enqueue CRM webhook events from lead-interest upserts and watched CRM edit fields.
