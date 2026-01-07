# Phase 3b — Harden `/api/webhooks/clay` Callback Parsing + Updates

## Focus
Make the Clay callback handler accept real-world Clay payloads (including current table configs) and reliably update the Lead record, instead of silently doing nothing.

## Inputs
- Phase 3a canonical callback schema + alias list
- Existing code: `app/api/webhooks/clay/route.ts`

## Work
- Implement a normalization layer that:
  - Validates `leadId` and `enrichmentType`
  - Accepts `status` OR infers status from fields (`success` boolean, presence of `linkedinUrl`/`phone`, `error`)
  - Supports common field aliases (e.g., `phoneNumber` → `phone`)
  - Normalizes LinkedIn URLs + phone numbers using existing utilities
- Ensure status transitions remain correct when LinkedIn + phone callbacks arrive separately.
- Improve error responses for misconfigured callbacks (return 400 with actionable error instead of silent 200 no-op).
- Keep logs useful but non-sensitive.

## Output
- Updated callback handler that correctly updates `Lead.linkedinUrl` / `Lead.phone` and enrichment status with production-safe logging.

## Handoff
Provide example curl payloads and updated Clay HTTP API configuration values to verify end-to-end in Phase 3d.

