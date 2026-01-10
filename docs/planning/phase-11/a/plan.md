# Phase 11a — Requirements + Architecture Audit

## Focus
Define what “Calendly integration” means for this codebase by auditing the existing GHL booking/appointment flow and identifying the minimal set of Calendly capabilities needed to preserve current auto-booking logic.

## Inputs
- Existing booking + appointment ingestion codepaths (GHL appointments, follow-ups, availability/booking logic).
- Current Prisma data model (`prisma/schema.prisma`).
- Integrations UI + settings/actions for other providers.
- Calendly API/Webhook documentation (use Context7 as needed).
- Workspace provisioning endpoint expectations (`POST /api/admin/workspaces`) and current payload schema.

## Work
- Audit current booking flow (existing GHL path + availability/slot offers):
  - ✅ Auto-book decisioning + booking side effects: `lib/booking.ts`, `lib/followup-engine.ts`
  - ✅ Slot offering + storage: `lib/followup-engine.ts` writes `Lead.offeredSlots` when `{availability}` is used
  - ✅ Availability sources: `WorkspaceAvailabilityCache` derives from default `CalendarLink` (supports `calendly|hubspot|ghl`)
- Define Calendly parity requirements:
  - ✅ Minimum webhooks: `invitee.created` + `invitee.canceled`
  - ✅ Idempotency keys: `scheduled_event.uri` + `invitee.uri` (store on `Lead`)
  - ✅ Auto-booking feasibility: use Calendly “Scheduling API” (`POST /invitees`) to schedule on behalf of the lead (AI-agent workflow)
- Confirm workspace access-list inclusion:
  - ✅ Roles exist (`ClientMemberRole.SETTER|INBOX_MANAGER`) and there are UI actions to manage them (`actions/client-membership-actions.ts`)
  - ❌ `POST /api/admin/workspaces` only supports a single `inboxManagerEmail` today; no setter list / multi inbox manager support
- Produce implementation decisions:
  - Booking provider selection lives in `WorkspaceSettings` (default keeps current GHL behavior)
  - Secrets (Calendly token + webhook signing key) live on `Client` (not in `WorkspaceSettings`)

## Output
- **Existing GHL booking flow (parity baseline)**
  - Auto-book is triggered by inbound messages when the lead “accepts” a previously offered slot: `processMessageForAutoBooking()` → `bookMeetingOnGHL()` (`lib/followup-engine.ts`, `lib/booking.ts`).
  - Booking side effects: set `Lead.ghlAppointmentId`, `Lead.bookedSlot`, `Lead.appointmentBookedAt`, `Lead.status = "meeting-booked"`, clear `Lead.offeredSlots`, start post-booking sequence, and complete active follow-up instances not triggered by meeting selection (`lib/booking.ts`).
  - Slot offering uses cached availability from the workspace default `CalendarLink` (already supports `calendly` links) and stores the offered options on `Lead.offeredSlots` (`lib/followup-engine.ts`).
- **Calendly approach (decisions)**
  - **Auth:** per-workspace Calendly Personal Access Token (PAT) stored on `Client` (matches existing pattern of storing integration secrets on `Client`).
  - **Booking:** use Calendly “Scheduling API” (`POST /invitees`) to create the scheduled event when a lead accepts a slot; requires an `event_type` and invitee identity (at minimum email).
  - **Webhooks:** create a Calendly webhook subscription per workspace for `invitee.created` + `invitee.canceled`, pointing to `POST /api/webhooks/calendly/[clientId]`.
  - **Webhook security:** verify Calendly webhook signatures using the subscription signing key stored per workspace (fallback: allow temporarily running without signature verification if Calendly doesn’t return a signing key in create response; add later once confirmed in API response schema).
  - **Workspace binding:** store the Calendly `organization` URI and selected `event_type` URI for the workspace (used for webhook subscriptions and scheduling).
  - **State storage:** add lead-level fields for Calendly scheduled event identifiers (e.g., `calendlyInviteeUri`, `calendlyScheduledEventUri`) and treat “already booked” as “has *any* provider appointment id”.
- **Provisioning webhook check (access lists)**
  - `POST /api/admin/workspaces` will be extended to accept setter + inbox manager email lists and write to `ClientMember` (same roles as existing UI actions).

## Handoff
- Phase 11b should:
  - Add `WorkspaceSettings.meetingBookingProvider` (`"ghl" | "calendly"`, default `"ghl"`) and Calendly booking config fields (event type URI, optionally a display link).
  - Add `Client` fields for Calendly token + org/user + webhook subscription metadata (and keep them out of `getUserSettings` payloads).
  - Extend `POST /api/admin/workspaces` to accept setter + inbox manager lists (email → Supabase userId → `ClientMember` rows).
