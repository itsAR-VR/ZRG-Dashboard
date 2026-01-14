# Phase 20b — Availability Refresh Fallback (GHL/Calendly) Using Auto-Booking Calendar

## Focus
Reduce availability refresh failures/timeouts by using provider APIs (GHL/Calendly) as fallbacks, and always prefer the workspace’s configured auto-booking calendar link as the source of truth.

## Inputs
- Vercel cron logs showing timeouts fetching GHL booking pages like `https://api.gohighlevel.com/widget/bookings/<slug>`.
- Availability refresh implementation (`lib/availability-cache.ts`, `lib/calendar-availability.ts`).
- Workspace auto-booking settings (`WorkspaceSettings.meetingBookingProvider`, `ghlDefaultCalendarId`, `calendlyEventTypeLink/Uri`).

## Work
1. Reuse `WorkspaceAvailabilityCache.providerMeta` to cache resolved provider IDs (GHL calendarId, Calendly eventTypeUuid/timezone) and avoid repeated page/lookup calls.
2. Add a fallback path for GHL availability: if widget page fetch fails, use `WorkspaceSettings.ghlDefaultCalendarId` (if set) to call free-slots directly.
3. Add a fallback path for Calendly availability: if the configured default CalendarLink fails, try `WorkspaceSettings.calendlyEventTypeLink` (if set).
4. Tighten timeouts and ensure per-workspace errors are saved in `WorkspaceAvailabilityCache.lastError`.

## Output
- Cached provider identifiers to avoid repeated slow lookups:
  - `lib/calendar-availability.ts`:
    - `fetchCalendlyAvailabilityWithMeta(..., opts)` now supports cached `{ eventTypeUuid, availabilityTimezone }` (skips UUID resolution when available).
    - `fetchGHLAvailabilityWithMeta(..., opts)` now supports cached `{ calendarIdHint }` (skips booking-page fetch when available; re-resolves if stale).
  - `lib/availability-cache.ts`:
    - Reads existing `WorkspaceAvailabilityCache.providerMeta` for the current default calendar and reuses cached IDs.
    - Stores `calendlyAvailabilityTimezone` alongside `calendlyEventTypeUuid` for future refreshes.
- Added auto-booking fallbacks for availability:
  - GHL fallback uses `WorkspaceSettings.ghlDefaultCalendarId` when the default calendar link cannot be resolved.
  - Calendly fallback uses `WorkspaceSettings.calendlyEventTypeLink` when the default calendar link returns no slots.
- `WorkspaceAvailabilityCache.lastError` now preserves provider-level failures or indicates when a fallback source was used.

## Handoff
Proceed to Phase 20c to reduce GHL sync 429/PIT errors via bounded concurrency and to normalize/validate inputs that currently cause noisy 400s.
