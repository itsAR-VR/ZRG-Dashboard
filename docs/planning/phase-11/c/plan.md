# Phase 11c — Calendly API Client + Webhook Subscription Management

## Focus
Implement the Calendly API surface needed by the app, including webhook subscription creation/verification and (if required) generation of scheduling links used by auto-booking.

## Inputs
- Phase 11a/11b decisions + stored settings schema.
- Calendly API + webhook documentation (Context7).
- Existing integration client patterns in `lib/**`.
- Existing secret-validation patterns in API routes.

## Work
- Implement a typed Calendly API client in `lib/**`:
  - Authentication handling per workspace (OAuth token refresh if applicable).
  - Methods we need (likely: lookup user/org/event type, create/list/delete webhook subscriptions, create single-use scheduling link if supported/required).
- Add a server-side route/action to (re)register webhook subscriptions for a workspace:
  - Ensure it can be run safely multiple times (idempotent subscription management).
  - Persist subscription IDs and relevant metadata in the DB for health/debugging.
- Define webhook security verification:
  - Verify signatures (preferred) or shared secret validation based on Calendly’s webhook scheme.
  - Document any required env vars.

## Output
- **Calendly API client**
  - Added `lib/calendly-api.ts` with small typed wrappers for:
    - `GET /users/me` (workspace org/user resolution)
    - create/get/delete webhook subscriptions (`/webhook_subscriptions`)
- **Webhook subscription management**
  - Added `actions/calendly-actions.ts`:
    - `testCalendlyConnectionForWorkspace(clientId)` (caches `calendlyUserUri` + `calendlyOrganizationUri`)
    - `ensureCalendlyWebhookSubscriptionForWorkspace(clientId)` (idempotent; stores subscription URI + signing key when present)
    - `getCalendlyIntegrationStatusForWorkspace(clientId)` (safe status for UI)
  - Added `lib/app-url.ts` to build the public callback URL consistently.
  - Wired the Meeting Booking UI (Calendly provider) to “Test Connection” and “Ensure Webhooks”.

## Handoff
- Phase 11d should implement `POST /api/webhooks/calendly/[clientId]` and use the stored `Client.calendlyWebhookSigningKey` (if present) to verify authenticity before parsing/processing payloads.
