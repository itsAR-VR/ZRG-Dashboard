# Phase 88a — Metric Definitions + Query Contracts (Workflow + Reactivation)

## Focus
Lock definitions for (1) workflow-vs-initial booking attribution and (2) reactivation campaign KPIs, then specify the exact backend query contracts and data shapes needed by the Analytics UI.

## Inputs
- User requirements from Phase 88 root plan.
- Existing models in `prisma/schema.prisma`:
  - `FollowUpSequence`, `FollowUpInstance`, `FollowUpStep`, `FollowUpTask`
  - `ReactivationCampaign`, `ReactivationEnrollment`, `ReactivationSendLog`
  - `Lead`, `Message`, `Appointment` (as needed for booking signals)
- Existing analytics patterns:
  - `actions/analytics-actions.ts` (auth, caching, window semantics)
  - `components/dashboard/analytics-view.tsx` (current tab layout)
- Concurrent Phase 83 CRM analytics work that already extends Analytics.

## Work
1. Confirm how "meeting booked" is best represented for analytics:
   - Prefer `Lead.appointmentBookedAt` as the canonical booking timestamp.
   - Treat provider IDs (`ghlAppointmentId`, `calendlyInviteeUri`, etc.) as booking verification when needed.
2. Define "workflow attribution" precisely:
   - Which sequences count (e.g., meeting-requested workflows by name or triggerOn)?
   - How to detect "a follow-up step was sent" (use `FollowUpInstance.lastStepAt IS NOT NULL` as primary signal; `FollowUpTask` rows with `status = 'completed'` as backup).
   - How to handle multiple instances, restarts, and bookings without a sequence.
3. Define "reactivation response" precisely:
   - Inbound `Message` after `ReactivationEnrollment.sentAt` within window.
   - Confirm whether cross-channel inbound counts (email/sms/linkedin) are included (default: yes).
4. Specify query inputs/outputs:
   - Common window model: `{ from?: string; to?: string }` (ISO) and/or preset keys.
   - Types for:
     - Workflow attribution summary + optional per-step distribution.
     - Reactivation KPI rows (per campaign).
5. Write down edge-case rules to avoid ambiguity in implementation:
   - Booked but no `FollowUpInstance` found → "unattributed" (excluded or separate bucket).
   - Enrollment sent but later re-sent/reset → define which `sentAt` to use (use latest `sentAt` in window).
   - Leads with multiple inbound responses → response counted once per enrollment/campaign.

## Validation (RED TEAM)

- [ ] Verify `FollowUpInstance.lastStepAt` index exists; if not, add to performance notes for 88b.
- [ ] Confirm `ReactivationEnrollment.sentAt` is reliably populated when status = 'sent'.
- [ ] Check that booking signals (`appointmentBookedAt`, `ghlAppointmentId`, `calendlyInviteeUri`) are indexed for efficient date-range queries.

## Metric Definitions (Decision-Complete)

### Workflow Attribution

| Metric | Definition |
|--------|------------|
| **Total Booked (window)** | Count of leads where `appointmentBookedAt` is within `[from, to)` and workspace access applies. |
| **Booked from Initial** | Booked leads where NO `FollowUpInstance` exists with `lastStepAt < appointmentBookedAt`. |
| **Booked from Workflow** | Booked leads where at least one `FollowUpInstance` exists with `lastStepAt IS NOT NULL` AND `lastStepAt < appointmentBookedAt`. |
| **Unattributed** | Booked leads that don't fit either bucket (e.g., booking before instance started). |
| **Per-Sequence Breakdown** | For workflow-attributed bookings, count per `FollowUpSequence.id` (via `FollowUpInstance.sequenceId`). |

**Edge cases:**
- Multiple instances: If ANY instance has `lastStepAt < appointmentBookedAt`, count as workflow-attributed. For per-sequence breakdown, attribute to the sequence with the earliest `lastStepAt` that precedes the booking.
- Restarts: Use the earliest `lastStepAt` across all instances for that lead.
- No sequence enrollment ever: Count as "Initial".

### Reactivation KPIs

| Metric | Definition |
|--------|------------|
| **Total Sent (window)** | Count of `ReactivationEnrollment` where `status = 'sent'` AND `sentAt` within `[from, to)`. |
| **Responded** | Enrollments where an inbound `Message` exists for the lead with `sentAt > ReactivationEnrollment.sentAt`. |
| **Response Rate** | Responded / Total Sent. |
| **Meetings Booked** | Enrollments where lead has `appointmentBookedAt > ReactivationEnrollment.sentAt`. |
| **Booking Rate** | Meetings Booked / Total Sent. |

**Edge cases:**
- Multiple enrollments per lead: Attribute to the enrollment with the most recent `sentAt` that precedes the event.
- Cross-channel responses: Count inbound from any channel (email, sms, linkedin).

## API Contracts

### `getWorkflowAttributionAnalytics`

```typescript
export async function getWorkflowAttributionAnalytics(opts: {
  clientId?: string | null;
  from?: string; // ISO date
  to?: string;   // ISO date
}): Promise<{
  success: boolean;
  data?: WorkflowAttributionData;
  error?: string;
}>

export interface SequenceAttributionRow {
  sequenceId: string;
  sequenceName: string;
  bookedCount: number;
  percentage: number; // of total workflow-attributed
}

export interface WorkflowAttributionData {
  window: { from: string; to: string };
  totalBooked: number;
  bookedFromInitial: number;
  bookedFromWorkflow: number;
  unattributed: number;
  initialRate: number; // bookedFromInitial / totalBooked
  workflowRate: number; // bookedFromWorkflow / totalBooked
  bySequence: SequenceAttributionRow[]; // Per-sequence breakdown for workflow-attributed bookings
}
```

### `getReactivationCampaignAnalytics`

```typescript
export async function getReactivationCampaignAnalytics(opts: {
  clientId?: string | null;
  from?: string;
  to?: string;
}): Promise<{
  success: boolean;
  data?: ReactivationAnalyticsData;
  error?: string;
}>

export interface ReactivationCampaignKpiRow {
  campaignId: string;
  campaignName: string;
  totalSent: number;
  responded: number;
  responseRate: number;
  meetingsBooked: number;
  bookingRate: number;
}

export interface ReactivationAnalyticsData {
  window: { from: string; to: string };
  campaigns: ReactivationCampaignKpiRow[];
  totals: {
    totalSent: number;
    responded: number;
    responseRate: number;
    meetingsBooked: number;
    bookingRate: number;
  };
}
```

## Output
- Finalized metric definitions + edge-case rules (documented above).
- Decision-complete API contracts for the new server actions.
- Validation notes:
  - `FollowUpInstance.lastStepAt` has **no index** today (performance watchlist for workflow attribution).
  - `ReactivationEnrollment.sentAt` has **no index** today (reactivation window query could be slow).
  - `Lead.appointmentBookedAt` has **no index** today (windowed booking queries may scan).

## Coordination Notes

**Active overlaps:** Phase 83/90 both touch Analytics files (`actions/analytics-actions.ts`, `components/dashboard/analytics-view.tsx`).  
**Plan:** re-read current file state before edits and merge semantically; avoid overwriting CRM table additions.

## Handoff
Subphase 88b implements server actions and windowed queries per the contracts defined here. Query implementation must:
1. Use `accessibleClientWhere()` / `accessibleLeadWhere()` for auth.
2. Incorporate window bounds into cache keys (or use a separate windowed cache).
3. Add query timeout (10s) for large-workspace resilience.
