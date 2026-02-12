# Phase 142e — Webhook Integration + Follow-Up Guard + Settings UI

## Focus

Wire the Calendly webhook to extract Q&A and enqueue qualification jobs, add the disqualification guard to follow-up automation, and add workspace settings controls.

## Inputs

- 142a–d complete (schema, API, core logic, job handler all ready)
- Re-read `app/api/webhooks/calendly/[clientId]/route.ts`, `lib/followup-automation.ts`, `actions/settings-actions.ts`, `components/dashboard/settings-view.tsx` immediately before editing (concurrent phase risk from 141)

## Work

### 1. Modify `app/api/webhooks/calendly/[clientId]/route.ts`

#### 1a. Extend `parseInviteePayload()` return type and extraction

Add `questionsAndAnswers` to the return type. Extract from `payload.invitee.questions_and_answers`:

```ts
const rawQA = getNested(invitee, "questions_and_answers");
let questionsAndAnswers: Array<{ question: string; answer: string; position: number }> | null = null;
if (Array.isArray(rawQA)) {
  const parsed = rawQA
    .filter((item: unknown) => item && typeof item === "object")
    .map((item: Record<string, unknown>) => ({
      question: typeof item.question === "string" ? item.question.trim() : "",
      answer: typeof item.answer === "string" ? item.answer.trim() : "",
      position: typeof item.position === "number" ? item.position : 0,
    }))
    .filter((qa) => qa.question && qa.answer);
  if (parsed.length > 0) questionsAndAnswers = parsed;
}
```

#### 1b. In `invitee.created` handler — after appointment upsert, before side effects

```
1. Load workspace settings (calendlyEventTypeUri, bookingQualificationCheckEnabled)
2. Determine if this is the "with questions" event type (eventTypeUri === settings.calendlyEventTypeUri)
3. If match + has Q&A + feature enabled:
   a. Call storeBookingFormAnswersOnLead()
   b. Find lead's latest message ID: prisma.message.findFirst({ where: { leadId }, orderBy: { sentAt: "desc" } })
   c. Enqueue BOOKING_QUALIFICATION_CHECK via enqueueBackgroundJob()
   d. Set lead.bookingQualificationStatus = "pending"
4. If no match → skip (direct-book link, no qualification needed)
```

### 2. Modify `lib/followup-automation.ts`

In `autoStartPostBookingSequenceIfEligible()`, add early exit after existing guard checks:

```ts
if (lead.bookingQualificationStatus === "disqualified") {
  return { started: false, reason: "disqualified" };
}
```

Add `bookingQualificationStatus` to the lead `select` clause if not already present.

### 3. Settings UI + Server Action

**Re-read both files first** (Phase 141 may have modified them).

#### 3a. `actions/settings-actions.ts`

- Add `bookingQualificationCheckEnabled`, `bookingQualificationCriteria`, `bookingDisqualificationMessage` to `UserSettingsData` type
- Add to `getUserSettings()` select + return
- Add to `updateUserSettings()` data mapping (behind admin access gate)

#### 3b. `components/dashboard/settings-view.tsx`

Add in the Calendar & Booking section:

- **Switch**: "Post-Booking Qualification Check" (`bookingQualificationCheckEnabled`)
- **Textarea**: "Qualification Criteria" (`bookingQualificationCriteria`) — placeholder: "Describe what qualifies a lead for a meeting (e.g., company size > 50, decision-maker role, target industry)"
- **Textarea**: "Disqualification Message" (`bookingDisqualificationMessage`) — placeholder: "Custom message sent when a lead doesn't qualify. Use {reasons} for AI-detected reasons and {companyName} for your company name."
- Conditionally show textareas only when toggle is on
- Admin-gated (follow existing pattern)

### Verify

- `npm run build` passes
- `npm run lint` passes
- Calendly webhook with Q&A payload → answers stored on lead, job enqueued
- Calendly webhook with direct-book event type → no job enqueued
- Settings UI shows new controls, saves correctly
- Follow-up guard prevents sequence start for disqualified leads

## Output

Full feature wired end-to-end:
- Calendly webhook extracts Q&A → stores answers → enqueues qualification job
- Background job runs AI evaluation → cancels + notifies if disqualified
- Settings UI controls feature toggle + criteria + message template
- Follow-up automation respects disqualification status

## Handoff

Phase 142 complete. Future work: GHL reconciliation path integration (contact custom fields → qualification check during reconciliation cron).
