# Phase 12d — Provider-Aware Booking Helpers + Adoption

## Focus
Standardize meeting booked detection and booking-link generation around a workspace-configurable provider (GHL vs Calendly) and remove any “GHL-only” hardcoding.

## Inputs
- Workspace settings (search keys: `meetingBookingProvider`, `calendlyEventTypeLink`)
- Lead booking fields (search keys: `calendlyInviteeUri`, `ghlAppointmentId`)
- Existing booking/availability logic in `lib/**` and any auto-reply booking copy

## Work
- Implement/standardize helpers (names illustrative):
  - `isMeetingBooked(lead, workspaceSettings)`
    - Provider `GHL` → check `lead.ghlAppointmentId` (or canonical stored field)
    - Provider `CALENDLY` → check `lead.calendlyInviteeUri` / scheduled-event URI
  - `getBookingLink(workspaceSettings)`
    - Provider `GHL` → existing GHL booking link logic
    - Provider `CALENDLY` → `calendlyEventTypeLink` (or canonical field)
- Replace booking-related logic (auto-replies, follow-ups, analytics) to call helpers instead of checking GHL fields directly.
- Add a small set of unit-level checks (or integration smoke checks) to verify both providers behave correctly.

## Output
- Centralized provider-aware booking utilities: `lib/meeting-booking-provider.ts`
  - `isMeetingBooked(lead, settings)` (GHL uses `ghlAppointmentId`; Calendly uses `calendlyInviteeUri`/`calendlyScheduledEventUri`)
  - `getBookingLink(clientId, settings)` (Calendly uses `WorkspaceSettings.calendlyEventTypeLink`; GHL uses workspace default `CalendarLink`)
- Updated follow-up template variable `{calendarLink}` to be provider-aware:
  - `lib/followup-engine.ts` now resolves `{calendarLink}` via `getBookingLink(...)` instead of always using the default `CalendarLink` URL

## Handoff
Subphase 12e will use `isMeetingBooked` and sentiment rules to compute campaign KPIs accurately across providers.
