# Phase 28c — Calendly Booking Reconciliation (Lookup by Lead Email)

## Focus
Detect Calendly bookings/cancellations for leads by using `Lead.email` as the lookup key and storing Calendly URIs + timing/status on the lead, even when the webhook path was missed.

## Inputs
- Root context: `docs/planning/phase-28/plan.md`
- Schema decision: `docs/planning/phase-28/a/plan.md`
- Existing Calendly integration:
  - Tokens/URIs: `Client.calendlyAccessToken`, `Client.calendlyUserUri`, `Client.calendlyOrganizationUri`
  - Webhook handler: `app/api/webhooks/calendly/[clientId]/route.ts`
  - API helper: `lib/calendly-api.ts` (currently: `/users/me`, webhook subscriptions, invitee create; add read/search as needed)
- Existing lead fields: `Lead.email`, `Lead.calendlyInviteeUri`, `Lead.calendlyScheduledEventUri`, `Lead.bookedSlot`

## Work
1. Identify Calendly API lookup strategy for “find booking by invitee email”:
   - Use `GET /scheduled_events` with `invitee_email=<lead.email>` (direct filter), scoped to the workspace’s `organization` (and optionally `user`) and a bounded time window (`min_start_time`/`max_start_time`).
   - Fetch invitee + event details as needed:
     - `GET /scheduled_events/{event_uuid}` for event fields (e.g., `event_type`, `start_time`, `end_time`, `status`)
     - `GET /scheduled_events/{event_uuid}/invitees` to capture the invitee `uri`, `status`, and `no_show` when available
   - Use workspace-configured event type (`WorkspaceSettings.calendlyEventTypeUri`) to reduce noise when configured (best-effort: mismatch should not hard-fail reconciliation unless it’s clearly wrong).
2. Add minimal Calendly API helpers to support reconciliation:
   - List scheduled events filtered by invitee email + time window
   - Fetch scheduled event details (event_type, start/end, status)
   - List invitees for a scheduled event (invitee uri/status/no_show)
3. Reconciliation rules (idempotent):
   - If we find matching scheduled event(s) → upsert into the new `Appointment` table (provider = CALENDLY), and refresh lead-level rollups (`calendlyInviteeUri`, `calendlyScheduledEventUri`, `appointmentBookedAt`, `bookedSlot`, etc) only when they change.
   - If the matching event was canceled → set cancellation fields/status.
   - Guard against false matches:
     - require exact email match (case-insensitive)
     - optionally require event type match when configured
    - prefer “most relevant” event (next upcoming; else most recent)
   - If we detect cancellation/reschedule → create a FollowUpTask for review/re-book flows (UI “red” indicator).
4. Apply the same “booking verified” side effects as in Phase 28b:
   - Stop incompatible follow-up instances, start post-booking sequence when eligible.
5. Safety + performance:
   - Only run when `Client.calendlyAccessToken` + org/user URIs are configured.
   - Keep reconciliation time-window bounded and configurable (e.g., last 30–90 days + next 30–90 days).
   - Log only IDs and counts (no PII).

## Output

### Files Created/Modified

1. **`lib/calendly-api.ts`** - Added new API functions:
   - `listCalendlyScheduledEvents(accessToken, params)` - Lists scheduled events with filters including `invitee_email`, time range, and status
   - `listCalendlyEventInvitees(accessToken, scheduledEventUri)` - Gets invitees for a scheduled event
   - `getCalendlyScheduledEvent(accessToken, scheduledEventUri)` - Gets a single scheduled event by URI
   - New types: `CalendlyScheduledEvent`, `CalendlyInvitee`, `ListScheduledEventsParams`, `ListScheduledEventsResponse`, `ListEventInviteesResponse`

2. **`lib/calendly-appointment-reconcile.ts`** - **New file** with reconciliation logic:
   - `reconcileCalendlyBookingForLead(leadId, opts)` - Main reconciliation function for leads with email addresses
   - `reconcileCalendlyBookingByUri(leadId, scheduledEventUri, opts)` - Refresh status of an existing booking
   - `selectPrimaryCalendlyEvent(events)` - Selects the "primary" event (next upcoming or most recent non-canceled)
   - `normalizeCalendlyStatus(calendlyStatus)` - Maps Calendly statuses to our normalized values

### Calendly Event Lookup Strategy

Uses the `invitee_email` filter on `GET /scheduled_events` for efficient lookup:
1. Fetch scheduled events filtered by lead's email, organization, and time window
2. Optionally filter by configured `calendlyEventTypeUri` to reduce noise
3. For each event, fetch invitees to get the invitee URI
4. Select primary event using same logic as GHL

### Time Window

Default reconciliation time window:
- Lookback: 90 days (configurable via `opts.lookbackDays`)
- Lookahead: 90 days (configurable via `opts.lookaheadDays`)

### Calendly Status Mapping

| Calendly Status | Normalized Status |
|-----------------|------------------|
| `active` | `confirmed` |
| `canceled`, `cancelled` | `canceled` |
| Other | `confirmed` |

### Primary Event Selection Logic

Same as GHL (for consistency):
1. Prefer next upcoming active event (start time > now)
2. If none upcoming, prefer most recently scheduled active event
3. If all canceled, return the most recently canceled one (for audit trail)

### Reconciliation Side Effects

Same as GHL:
- On new booking: Start post-booking sequence, complete non-booking follow-up instances
- On cancellation: Set `appointmentStatus = "canceled"`, revert lead status to "qualified"

### Options for Reconciliation

```typescript
interface CalendlyReconcileOptions {
  source?: AppointmentSource;    // Default: "reconcile_cron"
  dryRun?: boolean;              // Don't write to database
  skipSideEffects?: boolean;     // Skip follow-up automation
  lookbackDays?: number;         // Days to look back (default: 90)
  lookaheadDays?: number;        // Days to look ahead (default: 90)
}
```

### Workspace Credentials Required

- `Client.calendlyAccessToken` - OAuth token
- `Client.calendlyOrganizationUri` - Organization URI for scoping event queries
- Optional: `WorkspaceSettings.calendlyEventTypeUri` - Filter to specific event type

## Handoff

Proceed to Phase 28d to build the unified cron job and backfill runner. Key requirements:
- Process leads in batches with cursor-based pagination using `appointmentLastCheckedAt`
- Call both GHL and Calendly reconciliation based on workspace provider setting
- Support resumable backfill with progress tracking
- Respect rate limits (GHL: 90 req/10s, Calendly: no documented limits but be conservative)

## Review Notes

- Evidence:
  - Reconcile logic: `lib/calendly-appointment-reconcile.ts`
  - API helpers: `lib/calendly-api.ts` (uses `invitee_email` filter on `GET /scheduled_events`)
- Deviations:
  - No `Appointment` table upsert; reconciliation updates lead-level fields.
  - Cancellation/reschedule FollowUpTasks (red indicator) are not implemented.
  - Event type filtering is best-effort (when configured) to avoid false negatives.
