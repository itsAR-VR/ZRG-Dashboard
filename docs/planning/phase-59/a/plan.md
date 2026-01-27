# Phase 59a — Update Code Templates

## Focus
Update all default follow-up sequence templates in `actions/followup-sequence-actions.ts` to match the user's exact canonical messaging. This ensures all new workspaces get the correct copy.

## Inputs
- User's canonical messaging from Phase 59 root plan
- Current templates in `actions/followup-sequence-actions.ts`
- Existing placeholder syntax: `{firstName}`, `{senderName}`, `{companyName}`, `{calendarLink}`, `{availability}`, `{result}`, `{qualificationQuestion1}`, `{qualificationQuestion2}`

## Work

### 1. Update `defaultMeetingRequestedLinkedInSteps()` (lines 849-874)

**Day 1 LinkedIn connection:**
```typescript
messageTemplate: `Hi {firstName}, just wanted to connect on here too as well as over email`
```

**Day 2 LinkedIn DM (if connected):**
```typescript
messageTemplate: `Thanks for connecting, {firstName}. If you'd like, here's my calendar to grab a quick call: {calendarLink}`
```

### 2. Update Meeting Requested Sequence SMS (lines 1036-1046)

**Day 0 SMS (same day as meeting requested):**
```typescript
{
  stepOrder: 1,
  dayOffset: 0,
  channel: "sms",
  messageTemplate: `Hi {firstName}, it's {senderName} from {companyName}, I just sent over an email but wanted to drop a text too incase it went to spam - here's the link {calendarLink}`,
  subject: null,
  condition: { type: "phone_provided" },
  requiresApproval: false,
  fallbackStepId: null,
}
```

### 3. Update `defaultNoResponseLinkedInSteps()` (lines 811-847)

**Day 2 LinkedIn (if connected):**
```typescript
messageTemplate: `Hi {firstName}, just following up on my email. Let me know if you'd like to chat about {result}.`
```

**Day 5 LinkedIn (if connected):**
```typescript
messageTemplate: `Hey {firstName}, circling back. If helpful, I have {availability}. Or grab a time here: {calendarLink}`
```

**Day 7 LinkedIn (if connected):**
```typescript
messageTemplate: `Last touch, {firstName}, should I close the loop on this, or do you still want to chat about {result}?`
```

### 4. Update No Response Email/SMS templates (lines 898-989)

Update to match exact copy from root plan.

### 5. Update Post-Booking Sequence (lines 1122-1140)

**Email:**
```typescript
messageTemplate: `Great, I've booked you in and you should get a reminder to your email.

Before the call would you be able to let me know {qualificationQuestion1} and {qualificationQuestion2} just so I'm able to prepare properly for the call.`
```

### 6. Restructure Meeting Requested Sequence Day Offsets

Current structure has Day 1/2/5/7. User's flow suggests:
- Day 0: SMS (same day as meeting requested trigger)
- Day 1: LinkedIn connection
- Day 2+: Follow-ups merge with No Response flow if no booking

Consider keeping current structure but updating copy to match.

## Output
- Updated `actions/followup-sequence-actions.ts` with new message templates
- Updated `lib/followup-sequence-linkedin.ts` with new LinkedIn templates
- All placeholder syntax preserved

## Handoff
Pass the updated code templates to Phase 59b, which will create a migration script to update existing sequences in the database to match the new templates.
