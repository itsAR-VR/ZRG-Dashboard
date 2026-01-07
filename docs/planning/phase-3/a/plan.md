# Phase 3a — Confirm Clay Schemas + Operator Config

## Focus
Lock down the exact Clay → ZRG callback request shape (headers + JSON body) and the ZRG → Clay request shape so we can fix the integration without guesswork.

## Inputs
- Screenshots of Clay HTTP API configuration for `POST https://zrg-dashboard.vercel.app/api/webhooks/clay`
- Code: `lib/clay-api.ts` (outbound requests), `app/api/webhooks/clay/route.ts` (callbacks)

## Work
- Confirm which direction the observed error belongs to:
  - Clay callback failing to send due to invalid header key `Content-Type:` (trailing colon)
- Enumerate current Clay callback body fields used in the tables (LinkedIn + phone):
  - Required: `leadId`, `enrichmentType`
  - Result fields: `linkedinUrl` / `phone`
  - Status fields: `status` vs `success` boolean (and any error/message fields)
- Confirm signature expectations:
  - Header name Clay sends (`x-clay-signature` / `x-webhook-signature`)
  - Whether it’s a static secret or HMAC
  - Required env vars: `CLAY_CALLBACK_SECRET`, optional `CLAY_CALLBACK_USE_HMAC`
- Document the canonical callback schema we will support (and acceptable aliases).

## Output
- A concrete “Clay config checklist” (header key/value + body fields) and a canonical callback JSON schema used as the implementation target.

## Handoff
Use the canonical schema + alias list to implement tolerant parsing and deterministic status inference in Phase 3b.

