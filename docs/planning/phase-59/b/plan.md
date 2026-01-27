# Phase 59b — Migration Script for Existing Sequences

## Focus
Create and execute a migration script that updates all existing default follow-up sequences in the database to match the new standardized messaging from Phase 59a.

## Inputs
- Updated message templates from Phase 59a
- Default sequence names:
  - "No Response Day 2/5/7"
  - "Meeting Requested Day 1/2/5/7"
  - "Post-Booking Qualification"
- Existing sequences in `FollowUpSequence` and `FollowUpStep` tables

## Work

### 1. Create Migration Script

Create `scripts/migrate-default-sequence-messaging.ts`:

```typescript
/**
 * Migration script to update default follow-up sequence messaging
 *
 * This script updates the messageTemplate field for all FollowUpStep records
 * belonging to sequences with the default names:
 * - "No Response Day 2/5/7"
 * - "Meeting Requested Day 1/2/5/7"
 * - "Post-Booking Qualification"
 *
 * Run with: npx ts-node scripts/migrate-default-sequence-messaging.ts
 */

import { prisma } from "../lib/prisma";

const DEFAULT_SEQUENCE_NAMES = {
  noResponse: "No Response Day 2/5/7",
  meetingRequested: "Meeting Requested Day 1/2/5/7",
  postBooking: "Post-Booking Qualification",
};

// Define the canonical templates keyed by (sequenceName, channel, dayOffset)
const CANONICAL_TEMPLATES = {
  // No Response sequence
  [`${DEFAULT_SEQUENCE_NAMES.noResponse}:email:2`]: `Hi {firstName}, could I get the best number to reach you on so we can give you a call?`,
  [`${DEFAULT_SEQUENCE_NAMES.noResponse}:sms:2`]: `Hey {firstName}, when is a good time to give you a call?`,
  [`${DEFAULT_SEQUENCE_NAMES.noResponse}:email:5`]: `Hi {firstName}, just had time to get back to you.

I'm currently reviewing the slots I have left for new clients and just wanted to give you a fair shot in case you were still interested in {result}.

No problem if not but just let me know. I have {availability} and if it's easier here's my calendar link for you to choose a time that works for you: {calendarLink}`,
  [`${DEFAULT_SEQUENCE_NAMES.noResponse}:sms:5`]: `Hey {firstName}, {senderName} from {companyName} again

Just sent over an email about getting {result}

I have {availability} for you

Here's the link to choose a time to talk if those don't work: {calendarLink}`,
  [`${DEFAULT_SEQUENCE_NAMES.noResponse}:email:7`]: `Hey {firstName}, tried to reach you a few times but didn't hear back...

Where should we go from here?`,
  [`${DEFAULT_SEQUENCE_NAMES.noResponse}:sms:7`]: `Hey {firstName}, tried to reach you a few times but didn't hear back...

Where should we go from here?`,
  // LinkedIn steps for No Response
  [`${DEFAULT_SEQUENCE_NAMES.noResponse}:linkedin:2`]: `Hi {firstName}, just following up on my email. Let me know if you'd like to chat about {result}.`,
  [`${DEFAULT_SEQUENCE_NAMES.noResponse}:linkedin:5`]: `Hey {firstName}, circling back. If helpful, I have {availability}. Or grab a time here: {calendarLink}`,
  [`${DEFAULT_SEQUENCE_NAMES.noResponse}:linkedin:7`]: `Last touch, {firstName}, should I close the loop on this, or do you still want to chat about {result}?`,

  // Meeting Requested sequence
  [`${DEFAULT_SEQUENCE_NAMES.meetingRequested}:sms:0`]: `Hi {firstName}, it's {senderName} from {companyName}, I just sent over an email but wanted to drop a text too incase it went to spam - here's the link {calendarLink}`,
  [`${DEFAULT_SEQUENCE_NAMES.meetingRequested}:linkedin:1`]: `Hi {firstName}, just wanted to connect on here too as well as over email`,
  [`${DEFAULT_SEQUENCE_NAMES.meetingRequested}:linkedin:2`]: `Thanks for connecting, {firstName}. If you'd like, here's my calendar to grab a quick call: {calendarLink}`,

  // Post-Booking sequence
  [`${DEFAULT_SEQUENCE_NAMES.postBooking}:email:0`]: `Great, I've booked you in and you should get a reminder to your email.

Before the call would you be able to let me know {qualificationQuestion1} and {qualificationQuestion2} just so I'm able to prepare properly for the call.`,
};

async function migrateSequenceMessaging() {
  console.log("Starting default sequence messaging migration...");

  // Find all sequences with default names
  const sequences = await prisma.followUpSequence.findMany({
    where: {
      name: { in: Object.values(DEFAULT_SEQUENCE_NAMES) },
    },
    include: {
      steps: true,
    },
  });

  console.log(`Found ${sequences.length} default sequences to update`);

  let updatedSteps = 0;

  for (const sequence of sequences) {
    for (const step of sequence.steps) {
      const key = `${sequence.name}:${step.channel}:${step.dayOffset}`;
      const canonicalTemplate = CANONICAL_TEMPLATES[key];

      if (canonicalTemplate && step.messageTemplate !== canonicalTemplate) {
        await prisma.followUpStep.update({
          where: { id: step.id },
          data: { messageTemplate: canonicalTemplate },
        });
        console.log(`Updated step ${step.id} (${key})`);
        updatedSteps++;
      }
    }
  }

  console.log(`Migration complete. Updated ${updatedSteps} steps.`);
}

migrateSequenceMessaging()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

### 2. Dry-Run Verification

Before running, add a dry-run mode to preview changes:
- Log what would be updated
- Show before/after for each step
- Require confirmation before actual update

### 3. Execute Migration

1. Run in dry-run mode first
2. Review the changes
3. Execute the actual migration
4. Verify results

### 4. Verification Query

```sql
SELECT
  fs.name as sequence_name,
  step.channel,
  step."dayOffset",
  step."messageTemplate"
FROM "FollowUpSequence" fs
JOIN "FollowUpStep" step ON step."sequenceId" = fs.id
WHERE fs.name IN (
  'No Response Day 2/5/7',
  'Meeting Requested Day 1/2/5/7',
  'Post-Booking Qualification'
)
ORDER BY fs.name, step."dayOffset", step.channel;
```

## Output
- Migration script at `scripts/migrate-default-sequence-messaging.ts`
- All existing default sequences updated with canonical messaging
- Verification that new messaging is in place

## Handoff
Phase 59 complete. All default sequences (code and existing data) now use the standardized canonical messaging.
