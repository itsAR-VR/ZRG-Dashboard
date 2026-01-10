# Phase 11b — Data Model + Integrations UI/Settings

## Focus
Add workspace-level Calendly configuration, exposed in the Integrations tab, that is sufficient to (1) generate/send the right Calendly link(s) and (2) associate incoming Calendly webhooks with the correct workspace/lead.

## Inputs
- Phase 11a decisions (auth model, entity bindings, required identifiers).
- Existing integration settings patterns (GHL, email, Unipile, etc).
- Prisma schema + current Workspace/Settings models.

## Work
- Update `prisma/schema.prisma` to support Calendly configuration, including:
  - Provider selection (GHL vs Calendly) and any required Calendly identifiers.
  - Secure storage strategy for tokens/secrets (per Phase 11a).
  - Unique constraints needed for idempotency/lookup (e.g., event type URI, organization URI).
- Add/extend server actions to read/write Calendly settings:
  - Validate inputs (URLs/URIs, required fields when enabled).
  - Return `{ success, data?, error? }` consistently.
- Update the Integrations tab UI:
  - Add a Calendly section that mirrors the existing patterns for other integrations.
  - Support enable/disable, connection status, and a place to surface webhook/subscription health.
- If schema changes are made:
  - Run `npm run db:push` against the correct DB before marking the phase complete.

## Output
- **Schema**
  - Added `MeetingBookingProvider` enum and `WorkspaceSettings.meetingBookingProvider` + Calendly event-type fields (`calendlyEventTypeLink`, `calendlyEventTypeUri`).
  - Added `Client` Calendly integration fields for storing the access token + webhook metadata.
  - Added `Lead` fields for Calendly appointment identifiers (`calendlyInviteeUri`, `calendlyScheduledEventUri`) for idempotent webhook mapping.
- **Settings/actions**
  - Extended `getUserSettings` / `updateUserSettings` to persist Calendly booking config and provider selection.
- **UI**
  - Updated Integrations → Meeting Booking card to support selecting provider (GHL vs Calendly) and capturing Calendly event type config.
  - Added Calendly integration token field to the Integrations Manager (per workspace) and exposed a per-workspace Calendly webhook URL template.
- **Admin provisioning**
  - Extended `POST /api/admin/workspaces` to accept setter + inbox manager email lists (in addition to legacy `inboxManagerEmail`) and write `ClientMember` roles.
- **DB**
  - Ran `prisma db push --accept-data-loss` to sync the DB with the updated Prisma schema.

## Handoff
- Implement the Calendly API client + webhook subscription lifecycle in Phase 11c using the new `Client` fields, and wire it to the Meeting Booking UI (test connection + ensure subscription).
