# Phase 126b — Compute Capacity Utilization (% Booked) From Cache + Appointments

## Focus
Implement the actual capacity metric computation in a single reusable module so analytics and Insights can stay grounded and consistent.

## Inputs
- Availability cache source of truth:
  - `WorkspaceAvailabilityCache.slotsUtc` (Json — array of ISO datetime strings) for DEFAULT and DIRECT_BOOK sources.
  - Unique constraint: `@@unique([clientId, availabilitySource])` — at most 2 cache rows per workspace.
- Booking source of truth:
  - `Appointment` rows (CONFIRMED, windowed by `startAt`).
- Attribution fields added in 126a:
  - `Appointment.ghlCalendarId` / `Appointment.calendlyEventTypeUri`.
- Composite index added in 126a:
  - `@@index([leadId, status, startAt])` mitigates nested filter performance.

## Work

### 1. Create a new module: `lib/calendar-capacity-metrics.ts`

Export `getWorkspaceCapacityUtilization({ clientId, windowDays?: number })`.

**Output shape (decision-complete, all fields required):**
```typescript
interface CapacityUtilization {
  // Window
  fromUtcIso: string;           // ISO string (Server Action safe)
  toUtcIso: string;             // ISO string
  windowDays: number;           // default 30

  // Combined
  bookedSlots: number;
  availableSlots: number;
  totalSlots: number;           // bookedSlots + availableSlots
  bookedPct: number | null;     // null when totalSlots === 0

  // Breakdown
  breakdown: {
    source: "DEFAULT" | "DIRECT_BOOK";
    availableSlots: number;
    bookedSlots: number;
    totalSlots: number;
    bookedPct: number | null;
  }[];

  // Unattributed
  unattributedBookedSlots: number;

  // Cache meta (REQUIRED — RED TEAM H-2)
  cacheMeta: {
    fetchedAtIso: string;       // ISO string (.toISOString() — RED TEAM H-4)
    isStale: boolean;           // staleAt < now
    calendarType: string;       // 'ghl' | 'calendly' | 'unknown'
    calendarUrl: string;
    lastError: string | null;
  }[];
}
```

### 2. Rules and edge cases

- **Slot filtering is in-memory array processing (RED TEAM M-1):** `slotsUtc` is a `Json` field storing a string array. Parse, then filter in-memory:
  ```typescript
  const slots: string[] = cache.slotsUtc as string[];
  const now = new Date();
  const windowEnd = addDays(now, windowDays);
  const futureSlots = slots.filter(s => {
    const d = new Date(s);
    return d >= now && d < windowEnd;
  });
  ```
  Consider reusing `getWorkspaceAvailabilitySlotsUtc()` from `lib/availability-cache.ts` which already filters past slots, then apply the window-end filter on top.

- Count "booked" as `AppointmentStatus.CONFIRMED` only (consistent with intent).

- Denominator is `(booked + available)`; return `bookedPct = null` when denom === 0.

- **No cache refresh:** Call `getWorkspaceAvailabilityCache(clientId, { refreshIfStale: false })` or direct DB read. Never trigger external provider calls from analytics.

- **Date serialization safety (RED TEAM H-4):** `getWorkspaceAvailabilityCache()` returns `fetchedAt: Date` and `staleAt: Date`. Convert to ISO strings at return boundary:
  ```typescript
  fetchedAtIso: cache.fetchedAt.toISOString(),
  isStale: cache.staleAt < new Date(),
  ```

- **Provider mapping:**
  - If `WorkspaceSettings.meetingBookingProvider = GHL`:
    - DEFAULT: match `Appointment.ghlCalendarId` to `WorkspaceSettings.ghlDefaultCalendarId`
    - DIRECT_BOOK: match to `WorkspaceSettings.ghlDirectBookCalendarId`
  - If provider = CALENDLY:
    - DEFAULT: match `Appointment.calendlyEventTypeUri` to `WorkspaceSettings.calendlyEventTypeUri`
    - DIRECT_BOOK: match to `WorkspaceSettings.calendlyDirectBookEventTypeUri`
  - If workspace is missing configuration for a source (no direct-book id/uri), DIRECT_BOOK breakdown returns zeros.

- **Unattributed definition (RED TEAM M-3):** Appointments with `status = CONFIRMED` in window but attribution field is NULL or doesn't match any configured calendar/event-type. Multiple root causes are conflated (pre-Phase-126 historical, decommissioned calendar, webhook gap) — this is acceptable for v1. Tooltip will explain ambiguity.

### 3. Implementation notes (query patterns)

**Availability counts:** Derive from cached `slotsUtc` length after in-memory window filter.

**Booked counts:** Use Prisma `appointment.count` with nested filter:
```typescript
await prisma.appointment.count({
  where: {
    lead: { clientId },             // Nested — mitigated by composite index
    status: AppointmentStatus.CONFIRMED,
    startAt: { gte: now, lt: windowEnd },
    ghlCalendarId: configuredCalendarId,  // or calendlyEventTypeUri
  },
});
```

**Unattributed count:** Separate query for appointments in window where:
- `status = CONFIRMED`
- `lead: { clientId }`
- `ghlCalendarId IS NULL` (GHL) or `calendlyEventTypeUri IS NULL` (Calendly)
- OR attribution value doesn't match any configured identifier

### Validation Steps
1. Call `getWorkspaceCapacityUtilization` for a workspace with configured calendar + at least 1 CONFIRMED booking in next 30d → verify `bookedPct` is a number between 0-1
2. Call for a workspace with NO calendar configured → verify `bookedPct: null`, `totalSlots: 0`
3. Call for a workspace with stale cache → verify `cacheMeta[].isStale === true`
4. Verify no `Date` objects in the returned shape (all ISO strings)
5. Verify `combined.totalSlots === sum(breakdown[].totalSlots) + unattributedBookedSlots`

## Output
- A single function that returns a fully computed, serializable capacity object for analytics and Insights.

## Handoff
Proceed to Phase 126c to wire this into `getAnalytics` and render it in the Analytics UI and Insights Chat snapshot.
