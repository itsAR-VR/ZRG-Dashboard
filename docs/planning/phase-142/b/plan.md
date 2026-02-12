# Phase 142b — Calendly API Extensions

## Focus

Add the Calendly scheduled event cancellation API function and extend the `CalendlyInvitee` interface to include `questions_and_answers`. These are the external API primitives needed by downstream subphases.

## Inputs

- 142a complete (Prisma types available)
- Existing `lib/calendly-api.ts` patterns (`calendlyRequest<T>()` helper, interface conventions)

## Work

### 1. Extend `CalendlyInvitee` interface (~line 316 in `lib/calendly-api.ts`)

Add optional `questions_and_answers` field:

```ts
questions_and_answers?: Array<{
  question: string;
  answer: string;
  position: number;
}>;
```

This matches the Calendly API response shape. The field is optional because not all invitees have custom questions.

### 2. Add `cancelCalendlyScheduledEvent()` function

Add after `getCalendlyScheduledEvent()` (~line 422). Follows the existing `calendlyRequest<T>()` pattern:

```ts
export async function cancelCalendlyScheduledEvent(
  accessToken: string,
  scheduledEventUri: string,
  opts?: { reason?: string }
): Promise<CalendlyApiResult<{ canceled: true }>> {
  const url = `${scheduledEventUri}/cancellation`;
  const res = await calendlyRequest<unknown>(accessToken, url, {
    method: "POST",
    body: JSON.stringify({ reason: opts?.reason || "" }),
  });
  if (!res.success) return res;
  return { success: true, data: { canceled: true } };
}
```

Calendly API endpoint: `POST /scheduled_events/{uuid}/cancellation` with optional `reason` string.

### Verify

- `npm run build` passes
- `npm run lint` passes
- New function signature matches Calendly API docs

## Output

`lib/calendly-api.ts` updated with:
- `CalendlyInvitee.questions_and_answers` field
- `cancelCalendlyScheduledEvent()` function

## Handoff

142c can now import `cancelCalendlyScheduledEvent` for the disqualification orchestrator.
