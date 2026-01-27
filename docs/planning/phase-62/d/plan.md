# Phase 62d — Calendly API: Add questions_and_answers Parameter

## Focus
Update the Calendly API client to support passing qualification question answers when creating an invitee.

## Inputs
- Booking routing logic from 62c that calls `createCalendlyInvitee()` with optional answers
- Existing Calendly API client in `lib/calendly-api.ts`
- Calendly API documentation for `POST /invitees`

## Work

### Research Calendly API Schema
Before implementation, verify the exact format from Calendly docs:
- Endpoint: `POST https://api.calendly.com/invitees`
- Expected `questions_and_answers` format

**Expected format (from Calendly docs):**
```json
{
  "event_type": "...",
  "start_time": "...",
  "invitee": { ... },
  "questions_and_answers": [
    {
      "question": "What is your company name?",
      "answer": "Acme Corp"
    },
    {
      "question": "What is your biggest challenge?",
      "answer": "Scaling our sales team"
    }
  ]
}
```

### Modify `createCalendlyInvitee()`
**File:** `lib/calendly-api.ts`

```typescript
export async function createCalendlyInvitee(
  accessToken: string,
  params: {
    eventTypeUri: string;
    startTimeIso: string;
    invitee: {
      email: string;
      name: string;
      timezone?: string;
    };
    questionsAndAnswers?: Array<{
      question: string;
      answer: string;
    }>;
  }
): Promise<
  CalendlyApiResult<{
    inviteeUri: string;
    scheduledEventUri: string | null;
  }>
> {
  const body: Record<string, unknown> = {
    event_type: params.eventTypeUri,
    start_time: params.startTimeIso,
    invitee: {
      email: params.invitee.email,
      name: params.invitee.name,
      timezone: params.invitee.timezone,
    },
  };

  // Add questions and answers if provided
  if (params.questionsAndAnswers && params.questionsAndAnswers.length > 0) {
    body.questions_and_answers = params.questionsAndAnswers;
  }

  const res = await calendlyRequest<{ resource?: any }>(accessToken, "/invitees", {
    method: "POST",
    body: JSON.stringify(body),
  });

  // ... rest of response handling ...
}
```

### Error Handling
Handle specific error cases:
- **400 Bad Request**: Question text mismatch (log warning, suggest checking configuration)
- **422 Unprocessable Entity**: Missing required questions (fall back to direct-book link if available)

### Validation
- [ ] API call succeeds with `questions_and_answers` parameter
- [ ] API call succeeds without `questions_and_answers` (backward compatible)
- [ ] Error handling for question mismatches
- [ ] `npm run lint` passes

## Output
- Updated `lib/calendly-api.ts` with `questionsAndAnswers` parameter support
- Clear error messages when question format is rejected

## Handoff
Calendly API is updated. Subphase 62e can now build the Settings UI to configure both booking links.

## Review Notes
- Implemented `questions_and_answers` as `{ question, answer, position }[]` (per Calendly docs), and added `getCalendlyEventType()` to fetch `custom_questions[]` for position mapping.
- Provider-error handling is primarily via booking-layer fallback (retry direct-book event type when questions-enabled booking fails), rather than hard-coded 400/422 branches here.
