# Phase 142c — Core Qualification Logic

## Focus

Create `lib/booking-qualification.ts` — the central module containing all post-booking qualification logic: storing form answers, AI evaluation, disqualification orchestration, and message building.

## Inputs

- 142a complete (schema fields available)
- 142b complete (`cancelCalendlyScheduledEvent()` available)
- Existing patterns: `normalizeQuestionKey()` from `lib/booking.ts:336`, `runStructuredJsonPrompt()` from `lib/ai/prompt-runner.ts`, `getWorkspaceQualificationQuestions()` + `StoredQualificationAnswers` from `lib/qualification-answer-extraction.ts`

## Work

### New file: `lib/booking-qualification.ts`

Contains four exported functions:

### 1. `storeBookingFormAnswersOnLead()`

```ts
storeBookingFormAnswersOnLead(opts: {
  leadId: string;
  clientId: string;
  questionsAndAnswers: Array<{ question: string; answer: string; position: number }>;
}): Promise<void>
```

- Load workspace qualification questions via `getWorkspaceQualificationQuestions(clientId)`
- Match Calendly Q&A to workspace question IDs by normalized question text (`normalizeQuestionKey()`)
- Set `confidence: 1.0` (direct form submission — not AI-extracted)
- Merge with existing `Lead.qualificationAnswers` (don't overwrite)
- Persist via `prisma.lead.update()`

### 2. `evaluateBookingQualification()`

```ts
evaluateBookingQualification(opts: {
  clientId: string;
  leadId: string;
  formAnswers: Record<string, { question: string; answer: string }>;
  qualificationCriteria: string;
  idealCustomerProfile?: string | null;
  serviceDescription?: string | null;
}): Promise<BookingQualificationResult | null>
```

Returns `{ qualified: boolean, confidence: number, reasoning: string, disqualificationReasons: string[] }`.

- Uses `runStructuredJsonPrompt()` with structured JSON schema (same pattern as meeting-overseer)
- Model: `gpt-5-mini`, `reasoningEffort: "medium"`, `temperature: 0`
- Prompt template vars: `criteria`, `icp`, `service`, `answers`
- Fail-open: returns `null` on AI error (caller treats as qualified)
- Budget: `min: 400, max: 800, retryMax: 1200`

### 3. `executeBookingDisqualification()`

```ts
executeBookingDisqualification(opts: {
  clientId: string;
  leadId: string;
  provider: "CALENDLY" | "GHL";
  reasoning: string;
  disqualificationReasons: string[];
}): Promise<{ success: boolean; cancelResult?: string; messageResult?: string; error?: string }>
```

Orchestrator that executes the full disqualification flow:

1. **Cancel booking** — Calendly: `cancelCalendlyScheduledEvent()`, GHL: `deleteGHLAppointment()`
2. **Update appointment** — `upsertAppointmentWithRollup()` with `status: CANCELED`, `cancelReason`
3. **Update lead** — set `bookingQualificationStatus = "disqualified"`, `status = "disqualified"`
4. **Cancel follow-up sequences** — `prisma.followUpInstance.updateMany()` for active/paused instances
5. **Send notification** — Calendly → `sendResendEmail()` via `lib/resend-email.ts`, GHL → `sendSmsSystem()` via `lib/system-sender.ts`

Uses customizable message from `buildDisqualificationMessage()`.

### 4. `buildDisqualificationMessage()`

Internal helper. Uses `WorkspaceSettings.bookingDisqualificationMessage` if set (with `{reasons}` and `{companyName}` variable substitution), otherwise returns a polished default.

### Verify

- `npm run build` passes
- `npm run lint` passes
- All imports resolve to existing utilities

## Output

`lib/booking-qualification.ts` created with all core qualification logic.

## Handoff

142d imports `evaluateBookingQualification` and `executeBookingDisqualification` for the background job handler. 142e imports `storeBookingFormAnswersOnLead` for the webhook handler.
