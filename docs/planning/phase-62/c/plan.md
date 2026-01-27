# Phase 62c — Booking Routing: Update Booking Logic for Dual Link Selection

## Focus
Modify the booking logic to route to the appropriate event type/calendar based on whether the lead has answered qualification questions.

## Inputs
- Answer extraction module from 62b: `hasQualificationAnswers()`, `getQualificationAnswersForBooking()`
- Schema from 62a: `WorkspaceSettings.calendlyDirectBookEventTypeLink/Uri`, `ghlDirectBookCalendarId`
- Existing booking logic in `lib/booking.ts`

## Work

### Modify `bookMeetingForLead()`
**File:** `lib/booking.ts`

Add logic to determine which link to use:

```typescript
export async function bookMeetingForLead(
  leadId: string,
  selectedSlot: string,
  opts?: { calendarIdOverride?: string }
): Promise<BookingResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { client: { include: { settings: true } } },
  });
  if (!lead) return { success: false, error: "Lead not found" };

  // Check if lead has qualification answers
  const hasAnswers = await hasQualificationAnswers(leadId);
  const qualificationAnswers = hasAnswers
    ? await getQualificationAnswersForBooking(leadId)
    : null;

  const provider = lead.client.settings?.meetingBookingProvider === "CALENDLY" ? "calendly" : "ghl";

  if (provider === "calendly") {
    return bookMeetingOnCalendly(leadId, selectedSlot, {
      useDirectBookLink: !hasAnswers,
      qualificationAnswers,
    });
  } else {
    return bookMeetingOnGHL(leadId, selectedSlot, {
      // If no answers and direct-book calendar configured, use it
      calendarIdOverride: !hasAnswers && lead.client.settings?.ghlDirectBookCalendarId
        ? lead.client.settings.ghlDirectBookCalendarId
        : opts?.calendarIdOverride,
    });
  }
}
```

### Modify `bookMeetingOnCalendly()`
Add support for:
1. `useDirectBookLink` option to select which event type
2. `qualificationAnswers` to pass to API

```typescript
export async function bookMeetingOnCalendly(
  leadId: string,
  selectedSlot: string,
  opts?: {
    useDirectBookLink?: boolean;
    qualificationAnswers?: Array<{ question: string; answer: string }> | null;
  }
): Promise<BookingResult> {
  // ... existing validation ...

  // Select event type based on answer presence
  let eventTypeUri = opts?.useDirectBookLink && settings?.calendlyDirectBookEventTypeUri
    ? settings.calendlyDirectBookEventTypeUri
    : (settings?.calendlyEventTypeUri || "").trim();

  // Resolve if needed (same pattern as today)
  if (!eventTypeUri) {
    const link = opts?.useDirectBookLink && settings?.calendlyDirectBookEventTypeLink
      ? settings.calendlyDirectBookEventTypeLink
      : (settings?.calendlyEventTypeLink || "").trim();
    // ... resolution logic ...
  }

  // Call Calendly API with optional questions
  const invitee = await createCalendlyInvitee(client.calendlyAccessToken, {
    eventTypeUri,
    startTimeIso,
    invitee: { email, name, timezone },
    questionsAndAnswers: opts?.qualificationAnswers || undefined,
  });

  // ... rest of booking logic ...
}
```

### Fallback Behavior
If direct-book link is not configured:
- Fall back to the single configured link
- Log a warning that direct-book link is recommended

### Validation
- [ ] Lead with answers → uses questions-enabled link
- [ ] Lead without answers → uses direct-book link (if configured)
- [ ] Lead without answers + no direct-book link → falls back to questions-enabled link
- [ ] `npm run lint` passes

## Output
- Updated `lib/booking.ts` with dual link routing logic
- Clear fallback behavior when direct-book link not configured

## Handoff
Booking routing is updated. Subphase 62d can now implement the Calendly API changes to pass `questions_and_answers`.
