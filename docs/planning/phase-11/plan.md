# Phase 11 — Calendly Integration (Scheduling + Auto-Booking Parity)

## Purpose
Add Calendly as a workspace-configurable booking provider (alongside the existing GHL booking path) so the system can send/drive bookings without setters manually scheduling.

## Context
Some clients use Calendly as their calendar source-of-truth and want bookings handled automatically the same way we currently handle GHL appointments. We need a Calendly integration that:
- Can be configured from the Integrations tab (including the Calendly link/event type configuration)
- Manages/receives Calendly webhooks so scheduled/canceled events are reflected in the app
- Plugs into the existing auto-booking flow while retaining the same logic and safety gates
- Includes a quick verification that provisioning/webhook payloads can include which setters and inbox managers have access to the workspace

## Objectives
* [x] Identify the minimal Calendly feature set required for parity with current booking flows
* [x] Implement secure workspace-level Calendly configuration + webhook plumbing
* [x] Map Calendly scheduled events into the existing appointment/lead lifecycle model
* [x] Integrate Calendly as a selectable provider in the auto-booking logic

## Constraints
- Preserve existing GHL booking behavior; Calendly is an alternative provider, not a replacement.
- Follow existing repo patterns (Next.js App Router API routes, Prisma singleton, `lib/**` utilities, `actions/**` write paths).
- Treat webhooks as untrusted input: validate signatures/secrets, sanitize payloads, and ensure idempotency.
- Never commit secrets/tokens; store per-workspace credentials safely and prefer least-privilege.

## Success Criteria
- [x] Integrations UI supports enabling/configuring Calendly per workspace (and disabling it cleanly).
- [x] Calendly webhook events create/update internal appointment state idempotently (scheduled + canceled at minimum).
- [x] Auto-booking can choose Calendly vs GHL per workspace without changing downstream follow-up logic.
- [x] Workspace provisioning/admin webhook supports (or is extended to support) including the list of setters and inbox managers with access.

## Subphase Index
* a — Requirements + architecture audit (GHL parity + access-list check)
* b — Data model + Integrations UI/settings for Calendly
* c — Calendly API client + webhook subscription management
* d — Calendly webhook ingestion → appointment/lead lifecycle mapping
* e — Auto-booking integration + end-to-end validation

## Phase Summary
- Added Calendly as a booking provider alongside GHL, including per-workspace token + webhook subscription management and a provider-aware auto-book path.
- Key code artifacts:
  - `prisma/schema.prisma` (Calendly + provider fields)
  - `lib/calendly-api.ts`, `lib/calendly-link.ts`, `lib/calendly-webhook.ts`, `lib/app-url.ts`
  - `actions/calendly-actions.ts`
  - `app/api/webhooks/calendly/[clientId]/route.ts`
  - `lib/booking.ts` + `lib/followup-engine.ts` (provider-aware booking)
  - `app/api/admin/workspaces/route.ts` (setter + inbox manager access lists)
  - UI: `components/dashboard/settings-view.tsx`, `components/dashboard/settings/integrations-manager.tsx`
- Validation: `npx prisma db push --accept-data-loss`, `npm run lint` (warnings only), `npm run build` succeeded.
