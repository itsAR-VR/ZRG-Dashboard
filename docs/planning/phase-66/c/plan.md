# Phase 66c — Create and Integrate Setter Email Reply Trigger (First Reply Only)

## Focus
Create a new function that triggers the "Meeting Requested" sequence when a setter sends their **first manual email reply** to an interested lead.

Important constraints:
- This trigger is **email-only** (no outbound SMS/LinkedIn triggers).
- The sequence should start **once** (first setter reply only), and schedule steps relative to the reply `sentAt`.

## Inputs
- Phase 66a completed: No Response auto-start disabled without breaking outbound-touch scheduling
- Phase 66b completed: sentiment-based Meeting Requested auto-start removed/disabled across inbound processors
- Email send path: `actions/email-actions.ts` → `sendEmailReplyInternal()` (creates the outbound email `Message` row with `sentByUserId`)
- Sequence name constant in follow-up automation: `MEETING_REQUESTED_SEQUENCE_NAME = "Meeting Requested Day 1/2/5/7"`
- Scheduling semantics: `lib/followup-schedule.ts` (dayOffset is a day-number; anchor scheduling to the reply timestamp)

## Work

### Step 1: Make sequence start time deterministic (reply-timestamp anchored)
Update `startSequenceInstance(...)` in `lib/followup-automation.ts` to accept an optional `startedAt` so the first step is scheduled relative to `message.sentAt` (not `Date.now()`).

### Step 2: Create the new trigger function in `lib/followup-automation.ts`
Add a new exported function (name locked by Phase 66 root plan):

```typescript
/**
 * Auto-start the Meeting Requested sequence when a setter sends their first manual email reply.
 *
 * Phase 66: Replaces sentiment-based triggering with setter-email-reply triggering.
 */
export async function autoStartMeetingRequestedSequenceOnSetterEmailReply(opts: {
  leadId: string;
  messageId: string;
  outboundAt: Date;
  sentByUserId: string | null;
}): Promise<{ started: boolean; reason?: string }> {
  if (!opts.sentByUserId) return { started: false, reason: "not_manual_sender" };

  const lead = await prisma.lead.findUnique({
    where: { id: opts.leadId },
    select: {
      id: true,
      clientId: true,
      status: true,
      sentimentTag: true,
      autoFollowUpEnabled: true,
      ghlAppointmentId: true,
      calendlyInviteeUri: true,
      calendlyScheduledEventUri: true,
      appointmentStatus: true,
      client: {
        select: {
          settings: { select: { followUpsPausedUntil: true, meetingBookingProvider: true } },
        },
      },
    },
  });

  if (!lead) return { started: false, reason: "lead_not_found" };

  // Must be an "interested" context; block known negatives.
  if (lead.status === "blacklisted" || lead.status === "unqualified" || lead.status === "not-interested") {
    return { started: false, reason: lead.status };
  }
  if (lead.sentimentTag === "Blacklist" || lead.sentimentTag === "Not Interested") {
    return { started: false, reason: "negative_sentiment" };
  }

  if (isWorkspaceFollowUpsPaused({ followUpsPausedUntil: lead.client.settings?.followUpsPausedUntil })) {
    return { started: false, reason: "workspace_paused" };
  }
  const meetingBookingProvider = lead.client.settings?.meetingBookingProvider ?? "GHL";
  if (isMeetingBooked(lead, { meetingBookingProvider })) {
    return { started: false, reason: "already_booked" };
  }
  if (!lead.autoFollowUpEnabled) return { started: false, reason: "lead_auto_followup_disabled" };

  // First setter email reply only (do not restart on later replies).
  const priorSetterReply = await prisma.message.findFirst({
    where: {
      leadId: lead.id,
      channel: "email",
      direction: "outbound",
      sentByUserId: { not: null },
      id: { not: opts.messageId },
    },
    select: { id: true },
  });
  if (priorSetterReply) return { started: false, reason: "not_first_setter_reply" };

  // Find the Meeting Requested sequence
  const sequence = await prisma.followUpSequence.findFirst({
    where: { clientId: lead.clientId, name: MEETING_REQUESTED_SEQUENCE_NAME, isActive: true },
    select: { id: true },
  });

  if (!sequence) return { started: false, reason: "sequence_not_found_or_inactive" };

  // Check if instance already exists (don't double-start)
  const existingInstance = await prisma.followUpInstance.findUnique({
    where: { leadId_sequenceId: { leadId: lead.id, sequenceId: sequence.id } },
    select: { id: true, status: true },
  });

  if (existingInstance) {
    return { started: false, reason: "instance_exists" };
  }

  // Start the sequence anchored to the reply timestamp.
  await startSequenceInstance(lead.id, sequence.id, { startedAt: opts.outboundAt });

  return { started: true };
}
```

### Step 3: Add call in `actions/email-actions.ts`
In `actions/email-actions.ts:sendEmailReplyInternal()`, after the outbound `Message` row is created and `bumpLeadMessageRollup(...)` runs:

```typescript
// Phase 66: Trigger Meeting Requested sequence when setter sends their first email reply
autoStartMeetingRequestedSequenceOnSetterEmailReply({
  leadId: lead.id,
  messageId: message.id,
  outboundAt: message.sentAt,
  sentByUserId: message.sentByUserId ?? null,
}).catch((err) => {
  console.error("[Email] Failed to auto-start meeting-requested sequence on setter email reply:", err);
});
```

### Step 4: Import in email-actions.ts

Add to imports:
```typescript
import { autoStartMeetingRequestedSequenceOnSetterEmailReply } from "@/lib/followup-automation";
```

## Output
- Implemented in working tree (uncommitted):
  - Added `autoStartMeetingRequestedSequenceOnSetterEmailReply(...)` to start Meeting Requested only on the setter’s first manual email reply.
  - Anchors scheduling to `message.sentAt` via `startSequenceInstance(..., { startedAt })`.
  - Integrated into `actions/email-actions.ts:sendEmailReplyInternal()` after message creation.
- Evidence: `docs/planning/phase-66/review.md`

## Handoff
Phase 66d updates default templates (Meeting Requested without Day 1 auto-email; No Response disabled by default).
