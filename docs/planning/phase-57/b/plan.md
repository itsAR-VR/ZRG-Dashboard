# Phase 57b — Fix GHL Reconcile-by-ID (Normalization + Watermark + Tests)

## Focus
Eliminate the `Missing ghlAppointmentId` failures by:
1. Adding response normalization to `getGHLAppointment()` that unwraps the `appointment` wrapper
2. Ensuring `reconcileGHLAppointmentById()` advances `appointmentLastCheckedAt` even on error (prevents retry storm)
3. Adding regression tests for the normalization logic

## Inputs
- Phase 57a taxonomy + confirmed root cause
- `lib/ghl-api.ts` — `getGHLAppointment()` at line 919–930
- `lib/ghl-appointment-reconcile.ts` — `reconcileGHLAppointmentById()` at line 312–396
- `lib/appointment-upsert.ts` — guard at line 157–159 (do not modify, fix upstream)
- `lib/appointment-reconcile-runner.ts` — call site at line 229–234

## Confirmed GHL Response Shapes (from production)

**Get Appointment by Event ID** (`GET /calendars/events/appointments/{eventId}`):
```json
{
  "appointment": {
    "status": "confirmed",
    "assignedUserId": "user-1",
    "address": "https://example.com/meeting",
    "calendarId": "cal-1",
    "contactId": "contact-1",
    "dateAdded": "2026-01-06T03:59:13.034Z",
    "dateUpdated": "2026-01-06T15:21:56.018Z",
    "endTime": "2026-01-06T09:30:00-07:00",
    "id": "appt-1",
    "locationId": "loc-1",
    "notes": "",
    "description": "",
    "startTime": "2026-01-06T09:00:00-07:00",
    "title": "Intro Call - Example Client",
    "users": [],
    "isRecurring": false,
    "createdBy": { "source": "contactdetails_page", "userId": "user-1" },
    "appointmentMeta": { "slotType": "custom" },
    "deleted": false
  },
  "traceId": "trace-1"
}
```

**Get Appointments For Contacts** (`GET /calendars/events?contactId=...`):
```json
{
  "events": [
    {
      "status": "confirmed",
      "id": "appt-1"
    }
  ],
  "traceId": "trace-2"
}
```

**Root Cause Confirmed:** `getGHLAppointment()` returns `{ appointment: {...}, traceId }` but code treats it as `GHLAppointment` directly, so `response.id` is `undefined` (actual ID is at `response.appointment.id`).

## Work

### Step 1: Add GHL appointment response normalizer
**File:** `lib/ghl-api.ts`

Create a normalization helper that unwraps the `appointment` wrapper:
```typescript
/**
 * Normalizes GHL appointment API responses.
 *
 * The "Get Appointment by Event ID" endpoint returns:
 *   { appointment: { id, ... }, traceId: "..." }
 *
 * This function unwraps the appointment and ensures required fields exist.
 */
function normalizeGhlAppointmentResponse(data: unknown): GHLAppointment | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;

  // Unwrap the appointment wrapper (primary case)
  // Also handle potential future shapes: event wrapper, or direct response
  const candidate =
    record.appointment ||
    record.event ||
    record;

  if (!candidate || typeof candidate !== 'object') return null;
  const obj = candidate as Record<string, unknown>;

  // Extract ID - the field is `id` in the actual response
  const id = obj.id ?? obj.eventId ?? obj.appointmentId;
  if (typeof id !== 'string' || !id) return null;

  return {
    id,
    calendarId: String(obj.calendarId ?? ''),
    locationId: String(obj.locationId ?? ''),
    contactId: String(obj.contactId ?? ''),
    title: String(obj.title ?? ''),
    startTime: String(obj.startTime ?? ''),
    endTime: String(obj.endTime ?? ''),
    appointmentStatus: String(obj.appointmentStatus ?? obj.status ?? ''),
    assignedUserId: typeof obj.assignedUserId === 'string' ? obj.assignedUserId : undefined,
    notes: typeof obj.notes === 'string' ? obj.notes : undefined,
    address: typeof obj.address === 'string' ? obj.address : undefined,
    dateAdded: typeof obj.dateAdded === 'string' ? obj.dateAdded : undefined,
    dateUpdated: typeof obj.dateUpdated === 'string' ? obj.dateUpdated : undefined,
  };
}
```

Update `getGHLAppointment()`:
```typescript
export async function getGHLAppointment(
  eventId: string,
  privateKey: string,
  opts?: { locationId?: string }
): Promise<GHLApiResponse<GHLAppointment>> {
  const result = await ghlRequest<unknown>(
    `/calendars/events/appointments/${encodeURIComponent(eventId)}`,
    privateKey,
    {},
    opts?.locationId
  );

  if (!result.success) return result as GHLApiResponse<GHLAppointment>;

  const normalized = normalizeGhlAppointmentResponse(result.data);
  if (!normalized) {
    console.warn(`[GHL] Unexpected appointment response shape for eventId=${eventId}`);
    return {
      success: false,
      error: 'GHL appointment response missing required ID field',
    };
  }

  return { success: true, data: normalized };
}
```

### Step 2: Add watermark advancement on error
**File:** `lib/ghl-appointment-reconcile.ts`

In `reconcileGHLAppointmentById()`, wrap the upsert in try/catch and advance watermark regardless:

```typescript
// At the end of reconcileGHLAppointmentById(), before the catch block:
// Add finally block to always advance watermark
} finally {
  // Always advance watermark to prevent retry storm
  if (!opts.dryRun) {
    await prisma.lead.update({
      where: { id: leadId },
      data: { appointmentLastCheckedAt: new Date() },
    }).catch(() => {
      // Ignore watermark update failures to not mask real errors
    });
  }
}
```

**Alternative approach (safer):** Move watermark update to the beginning of the function as an "optimistic" update, then only the actual reconciliation can fail. This prevents the error path from blocking future retries entirely.

### Step 3: Add regression tests
**File:** `lib/__tests__/ghl-appointment-response.test.ts` (new file)

```typescript
import { describe, it, expect } from 'vitest';
// Import the normalizer (may need to export it)

describe('normalizeGhlAppointmentResponse', () => {
  // Primary case: actual production response shape
  it('unwraps appointment wrapper (production shape)', () => {
    const input = {
      appointment: {
        id: 'appt-1',
        calendarId: 'cal-1',
        contactId: 'contact-1',
        locationId: 'loc-1',
        title: 'Intro to Example Company -  Example Client',
        startTime: '2026-01-06T09:00:00-07:00',
        endTime: '2026-01-06T09:30:00-07:00',
        appointmentStatus: 'invalid',
        assignedUserId: '6Be1RSmunocb4pdXVrMY',
        notes: '',
        address: 'https://example.com/meeting',
        dateAdded: '2026-01-06T03:59:13.034Z',
        dateUpdated: '2026-01-06T15:21:56.018Z',
      },
      traceId: '00000000-0000-0000-0000-000000000000',
    };
    const result = normalizeGhlAppointmentResponse(input);
    expect(result?.id).toBe('appt-1');
    expect(result?.calendarId).toBe('cal-1');
    expect(result?.contactId).toBe('contact-1');
  });

  // Defensive: handle direct response (no wrapper)
  it('handles direct response with id', () => {
    const input = { id: 'appt-123', calendarId: 'cal-1', startTime: '2026-01-25T10:00:00Z' };
    const result = normalizeGhlAppointmentResponse(input);
    expect(result?.id).toBe('appt-123');
  });

  // Defensive: handle event wrapper variant
  it('unwraps event wrapper', () => {
    const input = { event: { id: 'evt-789', startTime: '2026-01-25T10:00:00Z' } };
    const result = normalizeGhlAppointmentResponse(input);
    expect(result?.id).toBe('evt-789');
  });

  // Edge case: missing ID should fail gracefully
  it('returns null for missing ID', () => {
    const input = { appointment: { startTime: '2026-01-25T10:00:00Z' } };
    const result = normalizeGhlAppointmentResponse(input);
    expect(result).toBeNull();
  });

  // Edge case: null/undefined input
  it('returns null for null/undefined input', () => {
    expect(normalizeGhlAppointmentResponse(null)).toBeNull();
    expect(normalizeGhlAppointmentResponse(undefined)).toBeNull();
  });

  // Edge case: empty object
  it('returns null for empty object', () => {
    expect(normalizeGhlAppointmentResponse({})).toBeNull();
  });
});
```

### Step 4: Verify with local test
```bash
npm test -- --grep "ghl-appointment-response"
```

### Step 5: Build verification
```bash
npm run lint && npm run build
```

## Validation (RED TEAM)

- [x] `npm run lint` passes (only pre-existing warnings, no errors)
- [x] `npm run build` succeeds
- [x] Unit tests for normalizer are runnable in the repo test harness: `npm test`
- [x] Manual verification: New error message is "GHL appointment response missing required ID field" (clearer than "Missing ghlAppointmentId")
- [x] Verify error message changes from "Missing ghlAppointmentId" to "GHL appointment response missing required ID field" (clearer)

## Output

### Files Changed
- **`lib/ghl-api.ts`** — Added `normalizeGhlAppointmentResponse()` helper (exported for testing) and refactored `getGHLAppointment()` to unwrap the `{ appointment: {...} }` wrapper
- **`lib/ghl-appointment-reconcile.ts`** — Added `advanceWatermark()` helper in `reconcileGHLAppointmentById()` that advances `appointmentLastCheckedAt` on every exit path (success, error, skip) to prevent retry storms
- **`lib/__tests__/ghl-appointment-response.test.ts`** — New test file with 10 test cases covering production response shape, edge cases, and defensive handling

### Key Implementation Decisions
1. **Normalizer exported**: Made `normalizeGhlAppointmentResponse` public for direct unit testing
2. **Type narrowing**: Changed `ghlRequest<GHLAppointment>` to `ghlRequest<unknown>` so we handle the raw response
3. **Watermark helper**: Used `advanceWatermark()` helper for consistency across all return paths instead of a single `finally` block (cleaner with multiple early returns)
4. **Debug logging**: Added structured logging when normalization fails to aid future debugging

### Verification Results
```
npm run lint → ✓ (warnings only, no errors)
npm run build → ✓ (successful)
npm test → ✓ (includes `lib/__tests__/ghl-appointment-response.test.ts`)
```

## Handoff
**Proceed to Phase 57c** to fix the insights cron schema violation:
- Add `maxLength: 300` to JSON Schema for `agent_response`
- Add truncation in Zod validation as fallback
- Add regression test for overlong strings

## Assumptions / Open Questions (RED TEAM)

- **CONFIRMED:** GHL "Get Appointment by Event ID" returns `{ appointment: {...}, traceId }` wrapper (verified from production response). The `id` field is present inside `appointment`.

- **Defensive:** The normalizer also handles `event` wrapper and direct response shapes in case GHL changes behavior or other endpoints are used.

- **CLOSED:** Should we use the request `eventId` as a fallback if the response lacks any ID?
  - Decision: No — the response always includes `id` inside the `appointment` object. Fail fast if shape is unexpected.

## Review Notes

- Evidence:
  - `npm run lint` (pass; warnings only)
  - `npm run build` (pass)
  - `npm test` (pass)
- Deviations:
  - None.
- Follow-ups:
  - None.
