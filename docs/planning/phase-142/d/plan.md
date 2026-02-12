# Phase 142d — Background Job Handler + Runner Registration

## Focus

Create the background job handler for `BOOKING_QUALIFICATION_CHECK` and register it in the job runner dispatch.

## Inputs

- 142a complete (BackgroundJobType enum has `BOOKING_QUALIFICATION_CHECK`)
- 142c complete (`evaluateBookingQualification()`, `executeBookingDisqualification()` available)

## Work

### 1. New file: `lib/background-jobs/booking-qualification-check.ts`

```ts
runBookingQualificationCheckJob(params: {
  clientId: string;
  leadId: string;
  messageId: string;
}): Promise<void>
```

Flow:

1. **Guard checks** (early returns):
   - Lead not found → return
   - Already checked (`bookingQualificationStatus` is `qualified` or `disqualified`) → return
   - Appointment already canceled → return
   - Feature disabled (`bookingQualificationCheckEnabled = false`) → mark qualified, return
   - No criteria configured (`bookingQualificationCriteria` empty) → mark qualified, return
   - No form answers on lead → mark qualified, return (fail-open)

2. **Build form answers context** — Load `Lead.qualificationAnswers` + workspace questions, create `formAnswers` map with question text + answer text

3. **Run AI evaluation** — Call `evaluateBookingQualification()` with answers + criteria + ICP + service description (from `WorkspaceSettings`)

4. **Handle result**:
   - AI returned null (error) → mark qualified (fail-open)
   - `qualified: true` → update lead `bookingQualificationStatus = "qualified"`
   - `qualified: false` but `confidence < 0.7` → mark qualified (fail-safe), log reasoning
   - `qualified: false` and `confidence >= 0.7` → call `executeBookingDisqualification()`

### 2. Register in `lib/background-jobs/runner.ts`

Add import at top (~line 14):
```ts
import { runBookingQualificationCheckJob } from "@/lib/background-jobs/booking-qualification-check";
```

Add case in dispatch switch (after existing cases):
```ts
case BackgroundJobType.BOOKING_QUALIFICATION_CHECK: {
  await withAiTelemetrySource(telemetrySource, () =>
    runBookingQualificationCheckJob({
      clientId: lockedJob.clientId,
      leadId: lockedJob.leadId,
      messageId: lockedJob.messageId,
    })
  );
  break;
}
```

### Verify

- `npm run build` passes
- `npm run lint` passes
- Job handler follows same pattern as existing handlers (e.g., `sms-inbound-post-process.ts`)

## Output

- `lib/background-jobs/booking-qualification-check.ts` created
- `lib/background-jobs/runner.ts` updated with new case

## Handoff

142e wires the webhook to enqueue this job and adds the follow-up guard.
