import { prisma } from "@/lib/prisma";

const MEETING_REQUESTED_SEQUENCE_NAME = "Meeting Requested Day 1/2/5/7";
const POST_BOOKING_SEQUENCE_NAME = "Post-Booking Qualification";
const NO_RESPONSE_SEQUENCE_NAME = "No Response Day 2/5/7";

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
      autoFollowUpEnabled: true,
      autoBookMeetingsEnabled: true,
      ghlAppointmentId: true,
      client: { select: { settings: { select: { autoBookMeetings: true } } } },
    },
  });

  if (!lead) return { started: false, reason: "lead_not_found" };
  if (lead.ghlAppointmentId) return { started: false, reason: "already_booked" };
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
      autoFollowUpEnabled: true,
      ghlAppointmentId: true,
    },
  });

  if (!lead) return { started: false, reason: "lead_not_found" };
  if (!lead.ghlAppointmentId) return { started: false, reason: "no_appointment" };
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
  const lead = await prisma.lead.findUnique({
    where: { id: opts.leadId },
    select: {
      id: true,
      clientId: true,
      status: true,
      sentimentTag: true,
      autoFollowUpEnabled: true,
      ghlAppointmentId: true,
      followUpInstances: {
        where: { status: { in: ["active", "paused"] } },
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!lead) return { started: false, reason: "lead_not_found" };
  if (!lead.autoFollowUpEnabled) return { started: false, reason: "lead_auto_followup_disabled" };
  if (lead.status === "blacklisted" || lead.sentimentTag === "Blacklist") return { started: false, reason: "blacklisted" };
  if (lead.ghlAppointmentId) return { started: false, reason: "already_booked" };
  if (lead.followUpInstances.length > 0) return { started: false, reason: "instance_already_active" };

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
