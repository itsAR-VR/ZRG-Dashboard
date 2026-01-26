import { prisma } from "@/lib/prisma";
import { isMeetingBooked } from "@/lib/meeting-booking-provider";
import { isWorkspaceFollowUpsPaused } from "@/lib/workspace-followups-pause";

const MEETING_REQUESTED_SEQUENCE_NAME = "Meeting Requested Day 1/2/5/7";
const POST_BOOKING_SEQUENCE_NAME = "Post-Booking Qualification";
const NO_RESPONSE_SEQUENCE_NAME = "No Response Day 2/5/7";

function shouldTreatAsOutreachSequence(sequence: { name: string; triggerOn: string }): boolean {
  // Response-driven sequences should NOT be reset/paused by generic outreach logic.
  if (sequence.name === MEETING_REQUESTED_SEQUENCE_NAME) return false;
  if (sequence.name === POST_BOOKING_SEQUENCE_NAME) return false;
  if (sequence.triggerOn === "meeting_selected") return false;
  return true;
}

async function resetActiveFollowUpInstanceScheduleOnOutboundTouch(params: {
  instanceId: string;
  sequenceId: string;
  currentStep: number;
  touchedAt: Date;
  existingNextStepDue: Date | null;
}): Promise<{ updated: boolean; nextStepDue?: Date }> {
  const { instanceId, sequenceId, currentStep, touchedAt, existingNextStepDue } = params;

  const nextStep = await prisma.followUpStep.findFirst({
    where: { sequenceId, stepOrder: { gt: currentStep } },
    orderBy: { stepOrder: "asc" },
    select: { dayOffset: true },
  });

  // Sequence complete.
  if (!nextStep) return { updated: false };

  const currentStepMeta =
    currentStep > 0
      ? await prisma.followUpStep.findUnique({
          where: { sequenceId_stepOrder: { sequenceId, stepOrder: currentStep } },
          select: { dayOffset: true },
        })
      : null;

  const currentOffset = currentStepMeta?.dayOffset ?? 0;
  const dayDiff = Math.max(0, nextStep.dayOffset - currentOffset);
  const candidateDue = new Date(touchedAt.getTime() + dayDiff * 24 * 60 * 60 * 1000);

  // Never pull the next step earlier.
  if (existingNextStepDue && existingNextStepDue > candidateDue) {
    return { updated: false };
  }

  await prisma.followUpInstance.update({
    where: { id: instanceId },
    data: { nextStepDue: candidateDue },
  });

  return { updated: true, nextStepDue: candidateDue };
}

async function wasHumanOutboundAtApproxTime(params: { leadId: string; outboundAt: Date }): Promise<boolean> {
  const windowMs = 5 * 60 * 1000;
  const from = new Date(params.outboundAt.getTime() - windowMs);
  const to = new Date(params.outboundAt.getTime() + windowMs);

  const recentHumanOutbound = await prisma.message.findFirst({
    where: {
      leadId: params.leadId,
      direction: "outbound",
      sentAt: { gte: from, lte: to },
      sentByUserId: { not: null },
    },
    select: { id: true },
  });

  return Boolean(recentHumanOutbound);
}

async function startSequenceInstance(leadId: string, sequenceId: string): Promise<void> {
  const sequence = await prisma.followUpSequence.findUnique({
    where: { id: sequenceId },
    include: {
      steps: { orderBy: { stepOrder: "asc" }, take: 1 },
    },
  });

  if (!sequence?.isActive) return;

  const firstStep = sequence.steps[0];
  const nextStepDue = firstStep
    ? new Date(Date.now() + firstStep.dayOffset * 24 * 60 * 60 * 1000)
    : null;

  await prisma.followUpInstance.upsert({
    where: { leadId_sequenceId: { leadId, sequenceId } },
    update: {
      status: "active",
      currentStep: 0,
      pausedReason: null,
      startedAt: new Date(),
      lastStepAt: null,
      nextStepDue,
      completedAt: null,
    },
    create: {
      leadId,
      sequenceId,
      status: "active",
      currentStep: 0,
      nextStepDue,
    },
  });
}

export async function autoStartMeetingRequestedSequenceIfEligible(opts: {
  leadId: string;
  previousSentiment: string | null;
  newSentiment: string | null;
}): Promise<{ started: boolean; reason?: string }> {
  if (opts.newSentiment !== "Meeting Requested") return { started: false, reason: "not_meeting_requested" };
  if (opts.previousSentiment === "Meeting Requested") return { started: false, reason: "already_meeting_requested" };

  const lead = await prisma.lead.findUnique({
    where: { id: opts.leadId },
    select: {
      id: true,
      clientId: true,
      status: true,
      sentimentTag: true,
      autoFollowUpEnabled: true,
      autoBookMeetingsEnabled: true,
      ghlAppointmentId: true,
      calendlyInviteeUri: true,
      calendlyScheduledEventUri: true,
      appointmentStatus: true,
      client: {
        select: {
          settings: { select: { autoBookMeetings: true, followUpsPausedUntil: true, meetingBookingProvider: true } },
        },
      },
    },
  });

  if (!lead) return { started: false, reason: "lead_not_found" };
  if (isWorkspaceFollowUpsPaused({ followUpsPausedUntil: lead.client.settings?.followUpsPausedUntil })) {
    return { started: false, reason: "workspace_paused" };
  }
  if (lead.status === "blacklisted" || lead.status === "unqualified" || lead.sentimentTag === "Blacklist") {
    return { started: false, reason: lead.status === "unqualified" ? "unqualified" : "blacklisted" };
  }
  const meetingBookingProvider = lead.client.settings?.meetingBookingProvider ?? "GHL";
  if (isMeetingBooked(lead, { meetingBookingProvider })) return { started: false, reason: "already_booked" };
  if (!lead.autoFollowUpEnabled) return { started: false, reason: "lead_auto_followup_disabled" };
  if (!lead.autoBookMeetingsEnabled) return { started: false, reason: "lead_auto_book_disabled" };
  if (!lead.client.settings?.autoBookMeetings) return { started: false, reason: "workspace_auto_book_disabled" };

  const sequence = await prisma.followUpSequence.findFirst({
    where: { clientId: lead.clientId, name: MEETING_REQUESTED_SEQUENCE_NAME, isActive: true },
    select: { id: true },
  });

  if (!sequence) return { started: false, reason: "sequence_not_found_or_inactive" };

  await startSequenceInstance(lead.id, sequence.id);
  return { started: true };
}

export async function autoStartPostBookingSequenceIfEligible(opts: {
  leadId: string;
}): Promise<{ started: boolean; reason?: string }> {
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
      client: { select: { settings: { select: { followUpsPausedUntil: true, meetingBookingProvider: true } } } },
    },
  });

  if (!lead) return { started: false, reason: "lead_not_found" };
  if (isWorkspaceFollowUpsPaused({ followUpsPausedUntil: lead.client.settings?.followUpsPausedUntil })) {
    return { started: false, reason: "workspace_paused" };
  }
  if (lead.status === "blacklisted" || lead.status === "unqualified" || lead.sentimentTag === "Blacklist") {
    return { started: false, reason: lead.status === "unqualified" ? "unqualified" : "blacklisted" };
  }
  const postBookingProvider = lead.client.settings?.meetingBookingProvider ?? "GHL";
  if (!isMeetingBooked(lead, { meetingBookingProvider: postBookingProvider })) return { started: false, reason: "no_appointment" };
  if (!lead.autoFollowUpEnabled) return { started: false, reason: "lead_auto_followup_disabled" };

  const sequence = await prisma.followUpSequence.findFirst({
    where: { clientId: lead.clientId, name: POST_BOOKING_SEQUENCE_NAME, isActive: true },
    select: { id: true },
  });

  if (!sequence) return { started: false, reason: "sequence_not_found_or_inactive" };

  await startSequenceInstance(lead.id, sequence.id);
  return { started: true };
}

export async function autoStartNoResponseSequenceOnOutbound(opts: {
  leadId: string;
  outboundAt?: Date;
}): Promise<{ started: boolean; reason?: string }> {
  const outboundAt = opts.outboundAt || new Date();

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
      client: { select: { settings: { select: { followUpsPausedUntil: true, meetingBookingProvider: true } } } },
      followUpInstances: {
        where: { status: { in: ["active", "paused"] } },
        select: {
          id: true,
          status: true,
          pausedReason: true,
          sequenceId: true,
          currentStep: true,
          nextStepDue: true,
          sequence: { select: { name: true, triggerOn: true } },
        },
        take: 20,
      },
    },
  });

  if (!lead) return { started: false, reason: "lead_not_found" };
  if (isWorkspaceFollowUpsPaused({ followUpsPausedUntil: lead.client.settings?.followUpsPausedUntil })) {
    return { started: false, reason: "workspace_paused" };
  }
  if (!lead.autoFollowUpEnabled) return { started: false, reason: "lead_auto_followup_disabled" };
  if (lead.status === "blacklisted" || lead.status === "unqualified" || lead.sentimentTag === "Blacklist") {
    return { started: false, reason: lead.status === "unqualified" ? "unqualified" : "blacklisted" };
  }
  const noResponseProvider = lead.client.settings?.meetingBookingProvider ?? "GHL";
  if (isMeetingBooked(lead, { meetingBookingProvider: noResponseProvider })) return { started: false, reason: "already_booked" };

  const activeInstances = lead.followUpInstances.filter((i) => i.status === "active");
  if (activeInstances.length > 0) {
    // If a human just touched this lead, reset follow-up timing so cron doesn't overlap with manual nurturing.
    const isHumanOutbound = await wasHumanOutboundAtApproxTime({ leadId: opts.leadId, outboundAt });
    if (!isHumanOutbound) return { started: false, reason: "instance_already_active" };

    const outreachInstances = activeInstances.filter((i) =>
      shouldTreatAsOutreachSequence({ name: i.sequence.name, triggerOn: i.sequence.triggerOn })
    );

    let resetCount = 0;
    for (const instance of outreachInstances) {
      const res = await resetActiveFollowUpInstanceScheduleOnOutboundTouch({
        instanceId: instance.id,
        sequenceId: instance.sequenceId,
        currentStep: instance.currentStep,
        touchedAt: outboundAt,
        existingNextStepDue: instance.nextStepDue ?? null,
      });
      if (res.updated) resetCount++;
    }

    return { started: false, reason: resetCount > 0 ? "active_instances_reset_on_human_outbound" : "instance_already_active" };
  }

  const pausedInstances = lead.followUpInstances.filter((i) => i.status === "paused");
  const pausedReplied = pausedInstances.filter((i) => i.pausedReason === "lead_replied");
  const pausedOther = pausedInstances.filter((i) => i.pausedReason !== "lead_replied");

  // Policy: if a no-response instance is paused due to a lead reply, re-enable it on the next outbound touch.
  // This ensures we only auto-follow up when the latest touch is outbound (from us).
  // BUT: If there's been recent inbound activity (within 48 hours), the conversation is "active"
  // and a human is likely nurturing. Don't resume automated follow-ups to avoid spam/overlap.
  if (pausedReplied.length > 0 && pausedOther.length === 0) {
    // Check for recent inbound activity - indicates active conversation
    const recentActivityCutoffHours = 48;
    const recentActivityCutoff = new Date(Date.now() - recentActivityCutoffHours * 60 * 60 * 1000);

    const recentInbound = await prisma.message.findFirst({
      where: {
        leadId: opts.leadId,
        direction: "inbound",
        sentAt: { gte: recentActivityCutoff },
      },
      select: { id: true },
    });

    if (recentInbound) {
      return { started: false, reason: "recent_inbound_activity" };
    }

    const startAt = outboundAt;
    let resumed = 0;

    for (const instance of pausedReplied) {
      const nextStep = await prisma.followUpStep.findFirst({
        where: { sequenceId: instance.sequenceId, stepOrder: { gt: instance.currentStep } },
        orderBy: { stepOrder: "asc" },
        select: { dayOffset: true },
      });

      // If the sequence is already complete, mark it completed so a fresh instance can be started on this outbound.
      if (!nextStep) {
        await prisma.followUpInstance.update({
          where: { id: instance.id },
          data: {
            status: "completed",
            pausedReason: null,
            nextStepDue: null,
            completedAt: new Date(),
          },
        });
        continue;
      }

      const currentStepMeta =
        instance.currentStep > 0
          ? await prisma.followUpStep.findUnique({
              where: { sequenceId_stepOrder: { sequenceId: instance.sequenceId, stepOrder: instance.currentStep } },
              select: { dayOffset: true },
            })
          : null;

      // When resuming, schedule relative to this outbound touch while preserving the spacing between steps.
      const currentOffset = currentStepMeta?.dayOffset ?? 0;
      const dayDiff = Math.max(0, nextStep.dayOffset - currentOffset);
      const nextStepDue = new Date(startAt.getTime() + dayDiff * 24 * 60 * 60 * 1000);
      await prisma.followUpInstance.update({
        where: { id: instance.id },
        data: {
          status: "active",
          pausedReason: null,
          nextStepDue,
        },
      });
      resumed++;
    }

    if (resumed > 0) {
      return { started: true, reason: "resumed_on_outbound" };
    }
  }

  if (pausedInstances.length > 0) return { started: false, reason: "instance_already_active" };

  // Policy: only start follow-up sequencing for leads who have replied at least once (any channel).
  // This prevents "no response" sequences from running on leads with only outbound touches.
  const inboundMessage = await prisma.message.findFirst({
    where: {
      leadId: lead.id,
      direction: "inbound",
    },
    select: { id: true },
  });
  if (!inboundMessage) return { started: false, reason: "no_inbound_history" };

  const sequence = await prisma.followUpSequence.findFirst({
    where: { clientId: lead.clientId, isActive: true, triggerOn: "no_response" },
    select: { id: true, name: true },
    orderBy: { createdAt: "desc" },
  });

  if (!sequence) return { started: false, reason: "sequence_not_found_or_inactive" };

  // Prefer the default sequence name if present
  if (sequence.name !== NO_RESPONSE_SEQUENCE_NAME) {
    const named = await prisma.followUpSequence.findFirst({
      where: { clientId: lead.clientId, isActive: true, name: NO_RESPONSE_SEQUENCE_NAME },
      select: { id: true },
    });
    if (named) {
      sequence.id = named.id;
    }
  }

  const existing = await prisma.followUpInstance.findUnique({
    where: { leadId_sequenceId: { leadId: lead.id, sequenceId: sequence.id } },
    select: { id: true },
  });

  if (existing) return { started: false, reason: "instance_exists" };

  const firstStep = await prisma.followUpStep.findFirst({
    where: { sequenceId: sequence.id },
    orderBy: { stepOrder: "asc" },
    select: { dayOffset: true },
  });

  const startAt = opts.outboundAt || new Date();
  const nextStepDue = firstStep
    ? new Date(startAt.getTime() + firstStep.dayOffset * 24 * 60 * 60 * 1000)
    : null;

  await prisma.followUpInstance.create({
    data: {
      leadId: lead.id,
      sequenceId: sequence.id,
      status: "active",
      currentStep: 0,
      nextStepDue,
      startedAt: startAt,
    },
  });

  return { started: true };
}
