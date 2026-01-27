# Phase 66d — Update Default Templates (Meeting Requested minus Day 1 Auto-Email; No Response Disabled)

## Focus
Update default sequence templates to match the new workflow:

1) **Meeting Requested:** remove the Day 1 auto-email step (setter manual reply is the first touchpoint). Keep the rest of the sequence intact so it can absorb migrated No Response instances.
2) **No Response:** keep the template available but create it **disabled by default** for new workspaces (manual-use only).

## Inputs
- Phase 66c completed: New setter-reply trigger function
- Current template: `createMeetingRequestedSequence()` in `actions/followup-sequence-actions.ts` (lines 1002-1139)
- Current No Response default: `createDefaultSequence()` in `actions/followup-sequence-actions.ts`
- Scheduling semantics: `lib/followup-schedule.ts` treats `dayOffset` as a **day-number** (`1` = Day 1 baseline, 0 days after start)
- Current steps structure:
  - Day 1: Email (template) + SMS (2 min delay) + LinkedIn (1 hour delay)
  - Day 2: Email + SMS + LinkedIn DM
  - Day 5: Email + SMS
  - Day 7: Email + SMS

## Work

### Step 1: Remove Day 1 Email from template

In `actions/followup-sequence-actions.ts`, modify `createMeetingRequestedSequence()`:

**Remove this step (currently stepOrder 1):**
```typescript
// DAY 1 - Email (meeting suggestion CTA)
{
  stepOrder: 1,
  dayOffset: 1,
  minuteOffset: 0,
  channel: "email",
  messageTemplate: `Sounds good, does {time 1 day 1} or {time 2 day 2} work for you?`,
  subject: "Scheduling a quick call",
  condition: { type: "always" },
  requiresApproval: false,
  fallbackStepId: null,
},
```

### Step 2: Keep dayOffset semantics consistent (do NOT use `dayOffset: 0` here)
Because `lib/followup-schedule.ts` treats `dayOffset=1` as “Day 1 baseline” (0 days after start), the “immediate after setter reply” steps should remain `dayOffset: 1`.

The new structure should be:
- **Day 1 (immediate after setter reply):** SMS (+2 min) + LinkedIn connect (+60 min)
- **Day 2:** Email + SMS + LinkedIn DM (if connected)
- **Day 5:** Email + SMS
- **Day 7:** Email + SMS

**Updated steps array:**
```typescript
const steps: Omit<FollowUpStepData, "id">[] = [
  // DAY 1 - SMS (2 minute delay after setter's reply)
  {
    stepOrder: 1,
    dayOffset: 1,
    minuteOffset: 2,
    channel: "sms",
    messageTemplate: `Hi {FIRST_NAME}, it's {name} from {company}, I just sent over an email but wanted to drop a text too incase it went to spam - here's the link {link}`,
    subject: null,
    condition: { type: "phone_provided" },
    requiresApproval: false,
    fallbackStepId: null,
  },
  // DAY 2 - Email asking for phone number
  {
    stepOrder: 2,
    dayOffset: 2,
    minuteOffset: 0,
    channel: "email",
    messageTemplate: `Hi {FIRST_NAME} could I get the best number to reach you on so we can give you a call?`,
    subject: "Re: Scheduling a quick call",
    condition: { type: "always" },
    requiresApproval: false,
    fallbackStepId: null,
  },
  // DAY 2 - SMS (only if phone provided)
  {
    stepOrder: 3,
    dayOffset: 2,
    minuteOffset: 0,
    channel: "sms",
    messageTemplate: `Hey {FIRST_NAME}, when is a good time to give you a call?`,
    subject: null,
    condition: { type: "phone_provided" },
    requiresApproval: false,
    fallbackStepId: null,
  },
  // DAY 5 - Email with availability
  {
    stepOrder: 4,
    dayOffset: 5,
    minuteOffset: 0,
    channel: "email",
    messageTemplate: `Hi {FIRST_NAME}, just had time to get back to you.

I'm currently reviewing the slots I have left for new clients and just wanted to give you a fair shot in case you were still interested in {achieving result}.

No problem if not but just let me know. I have {x day x time} and {y day y time} and if it's easier here's my calendar link for you to choose a time that works for you: {link}`,
    subject: "Re: Scheduling a quick call",
    condition: { type: "always" },
    requiresApproval: false,
    fallbackStepId: null,
  },
  // DAY 5 - SMS
  {
    stepOrder: 5,
    dayOffset: 5,
    minuteOffset: 0,
    channel: "sms",
    messageTemplate: `Hey {FIRST_NAME} - {name} from {company} again

Just sent over an email about getting {result}

I have {x day x time} and {y day y time} for you

Here's the link to choose a time to talk if those don't work  {link}`,
    subject: null,
    condition: { type: "phone_provided" },
    requiresApproval: false,
    fallbackStepId: null,
  },
  // DAY 7 - Email final check-in
  {
    stepOrder: 6,
    dayOffset: 7,
    minuteOffset: 0,
    channel: "email",
    messageTemplate: `Hey {{contact.first_name}}, tried to reach you a few times but didn't hear back….

Where should we go from here?`,
    subject: "Re: Scheduling a quick call",
    condition: { type: "always" },
    requiresApproval: false,
    fallbackStepId: null,
  },
  // DAY 7 - SMS final check-in
  {
    stepOrder: 7,
    dayOffset: 7,
    minuteOffset: 0,
    channel: "sms",
    messageTemplate: `Hey {{contact.first_name}}, tried to reach you a few times but didn't hear back….

Where should we go from here?`,
    subject: null,
    condition: { type: "phone_provided" },
    requiresApproval: false,
    fallbackStepId: null,
  },
];
```

### Step 3: Update LinkedIn steps

Update `defaultMeetingRequestedLinkedInSteps()` so the “connect” step is anchored to sequence start (setter reply), not “after the Day 1 email”:

```typescript
function defaultMeetingRequestedLinkedInSteps(): Array<Omit<FollowUpStepData, "id">> {
  return [
    // DAY 1 - LinkedIn connection request (1 hour after setter's reply)
    {
      stepOrder: 1, // temporary; will be renumbered
      dayOffset: 1,
      minuteOffset: 60, // 1 hour after the setter's reply
      channel: "linkedin",
      messageTemplate: `Hi {FIRST_NAME}, just wanted to connect on here too as well as over email`,
      subject: null,
      condition: { type: "always" },
      requiresApproval: false,
      fallbackStepId: null,
    },
    // DAY 2 - Follow up on LinkedIn if connected
    {
      stepOrder: 1, // temporary; will be renumbered
      dayOffset: 2,
      minuteOffset: 0,
      channel: "linkedin",
      messageTemplate: `Hi {FIRST_NAME} could I get the best number to reach you on so we can give you a call?`,
      subject: null,
      condition: { type: "linkedin_connected" },
      requiresApproval: false,
      fallbackStepId: null,
    },
  ];
}
```

### Step 4: Update sequence description

```typescript
const description = hasLinkedIn
  ? 'Triggered when setter sends first email reply: Day 1 (SMS + LinkedIn connect), Day 2 (Email + SMS + LinkedIn DM if connected), Day 5 (reminder), Day 7 (final check-in)'
  : 'Triggered when setter sends first email reply: Day 1 (SMS), Day 2 (Email + SMS), Day 5 (reminder), Day 7 (final check-in)';
```

### Step 5: Disable No Response upon creation (new workspaces)
`createFollowUpSequence(...)` currently forces `isActive: true`. Add an optional `isActive?: boolean` parameter (default true) so default sequences can be created disabled without hacks.

Then update `createDefaultSequence()` to create `"No Response Day 2/5/7"` with `isActive: false`.

## Output
- Implemented in working tree (uncommitted):
  - `createMeetingRequestedSequence()` no longer includes the Day 1 auto-email step; Day 1 now starts with SMS (+2 min) and LinkedIn connect (+1 hour).
  - `createFollowUpSequence()` now supports `isActive?: boolean`; default No Response is created with `isActive: false`.
  - Updated Meeting Requested description + LinkedIn step comments to reflect setter-reply trigger.
- Evidence: `docs/planning/phase-66/review.md`

## Handoff
Phase 66e: Verify lint, build, and type-check pass. Phase 66g applies DB migrations for existing workspaces.
