# Phase 79b — Manual Task Trigger Expansion

## Focus

Expand the manual task creation in `lib/lead-scheduler-link.ts` to trigger on "Meeting Requested" sentiment, not just "Meeting Booked". This ensures manual review happens earlier in the booking flow.

## Inputs

- Phase 79a: Draft generation now acknowledges lead scheduler links
- `lib/lead-scheduler-link.ts` current implementation
- `Lead.externalSchedulingLink` field

## Work

### 1. Expand Sentiment Check

**Location:** `lib/lead-scheduler-link.ts` line 78

Current:
```typescript
if (lead.sentimentTag !== "Meeting Booked") {
  return { handled: false, outcome: "sentiment_not_meeting_booked" };
}
```

Change to:
```typescript
const schedulingIntentSentiments = ["Meeting Requested", "Meeting Booked"];
if (!schedulingIntentSentiments.includes(lead.sentimentTag ?? "")) {
  return { handled: false, outcome: "sentiment_not_scheduling_intent" };
}
```

### 2. Differentiate Task Messaging

**Location:** Task creation (~line 110 and 134)

When sentiment is "Meeting Requested" (vs "Meeting Booked"), adjust the task message:
- For "Meeting Requested": "Lead shared their scheduler link. Consider booking via their calendar or asking for their preferred times."
- For "Meeting Booked": "Lead asked us to book via their scheduler link. Suggested overlap time..."

### 3. Update Outcome Messages

Change outcome from `"sentiment_not_meeting_booked"` to `"sentiment_not_scheduling_intent"` for clarity.

## Output

- Updated `lib/lead-scheduler-link.ts` to trigger manual tasks for both `"Meeting Requested"` and `"Meeting Booked"` when `Lead.externalSchedulingLink` is present.
- Updated outcome from `sentiment_not_meeting_booked` → `sentiment_not_scheduling_intent`.
- Adjusted task messaging so `"Meeting Requested"` is phrased as “shared their scheduler link” vs `"Meeting Booked"` as “asked us to book via their scheduler link”.

## Handoff

Phase 79 complete. Run verification:
```bash
npm run lint
npm run build
```

Confirm:
- AI drafts do not offer workspace times when `externalSchedulingLink` exists.
- A `FollowUpTask` is created for `"Meeting Requested"` + scheduler link.
