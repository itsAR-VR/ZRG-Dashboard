import { prisma } from "@/lib/prisma";
import { isMeetingBooked } from "@/lib/meeting-booking-provider";
import { isWorkspaceFollowUpsPaused } from "@/lib/workspace-followups-pause";
import { computeStepDeltaMs, computeStepOffsetMs } from "@/lib/followup-schedule";

// =============================================================================
// Constants
// =============================================================================

export const MEETING_REQUESTED_SEQUENCE_NAME = "Meeting Requested Day 1/2/5/7";
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
    select: { dayOffset: true, minuteOffset: true },
  });

  // Sequence complete.
  if (!nextStep) return { updated: false };

  const currentStepMeta =
    currentStep > 0
      ? await prisma.followUpStep.findUnique({
          where: { sequenceId_stepOrder: { sequenceId, stepOrder: currentStep } },
          select: { dayOffset: true, minuteOffset: true },
        })
      : null;

  const currentStepTiming = currentStepMeta ?? { dayOffset: 0, minuteOffset: 0 };
  const deltaMs = computeStepDeltaMs(currentStepTiming, nextStep);
  const candidateDue = new Date(touchedAt.getTime() + deltaMs);

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

async function startSequenceInstance(
  leadId: string,
  sequenceId: string,
  opts?: { startedAt?: Date }
): Promise<void> {
  const sequence = await prisma.followUpSequence.findUnique({
    where: { id: sequenceId },
    include: {
      steps: { orderBy: { stepOrder: "asc" }, take: 1 },
    },
  });

  if (!sequence?.isActive) return;

  const startedAt = opts?.startedAt ?? new Date();
  const firstStep = sequence.steps[0];
  const nextStepDue = firstStep
    ? new Date(startedAt.getTime() + computeStepOffsetMs(firstStep))
    : null;

  await prisma.followUpInstance.upsert({
    where: { leadId_sequenceId: { leadId, sequenceId } },
    update: {
      status: "active",
      currentStep: 0,
      pausedReason: null,
      startedAt,
      lastStepAt: null,
      nextStepDue,
      completedAt: null,
    },
    create: {
      leadId,
      sequenceId,
      status: "active",
      currentStep: 0,
      startedAt,
      nextStepDue,
    },
  });
}

/**
 * Phase 66: DEPRECATED — Sentiment-based Meeting Requested auto-start is disabled.
 *
 * This function previously started the "Meeting Requested" sequence when sentiment
 * changed to "Meeting Requested". As of Phase 66, this trigger is disabled.
 *
 * Meeting Requested sequences are now triggered by setter email reply instead
 * (see autoStartMeetingRequestedSequenceOnSetterEmailReply).
 *
 * @deprecated Use autoStartMeetingRequestedSequenceOnSetterEmailReply instead
 */
export async function autoStartMeetingRequestedSequenceIfEligible(opts: {
  leadId: string;
  previousSentiment: string | null;
  newSentiment: string | null;
}): Promise<{ started: boolean; reason?: string }> {
  // Phase 66: Sentiment-based auto-start is disabled.
  // Meeting Requested is now triggered by setter email reply only.
  return { started: false, reason: "sentiment_autostart_disabled" };
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

/**
 * Handle outbound touch scheduling for existing follow-up instances.
 * Extracted from autoStartNoResponseSequenceOnOutbound in Phase 66.
 *
 * This function:
 * - Resets active instance schedules on human outbound touches (so cron doesn't overlap with manual nurturing)
 * - Resumes paused instances on outbound touches (per policy)
 *
 * It does NOT create new sequence instances.
 */
export async function handleOutboundTouchForFollowUps(opts: {
  leadId: string;
  outboundAt?: Date;
}): Promise<{ updated: boolean; reason?: string; resetCount?: number; resumedCount?: number }> {
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

  if (!lead) return { updated: false, reason: "lead_not_found" };
  if (isWorkspaceFollowUpsPaused({ followUpsPausedUntil: lead.client.settings?.followUpsPausedUntil })) {
    return { updated: false, reason: "workspace_paused" };
  }
  if (!lead.autoFollowUpEnabled) return { updated: false, reason: "lead_auto_followup_disabled" };
  if (lead.status === "blacklisted" || lead.status === "unqualified" || lead.sentimentTag === "Blacklist") {
    return { updated: false, reason: lead.status === "unqualified" ? "unqualified" : "blacklisted" };
  }
  const bookingProvider = lead.client.settings?.meetingBookingProvider ?? "GHL";
  if (isMeetingBooked(lead, { meetingBookingProvider: bookingProvider })) return { updated: false, reason: "already_booked" };

  const activeInstances = lead.followUpInstances.filter((i) => i.status === "active");
  if (activeInstances.length > 0) {
    // If a human just touched this lead, reset follow-up timing so cron doesn't overlap with manual nurturing.
    const isHumanOutbound = await wasHumanOutboundAtApproxTime({ leadId: opts.leadId, outboundAt });
    if (!isHumanOutbound) return { updated: false, reason: "instance_already_active" };

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

    return {
      updated: resetCount > 0,
      reason: resetCount > 0 ? "active_instances_reset_on_human_outbound" : "instance_already_active",
      resetCount,
    };
  }

  const pausedInstances = lead.followUpInstances.filter((i) => i.status === "paused");
  const pausedReplied = pausedInstances.filter((i) => i.pausedReason === "lead_replied");
  const pausedOther = pausedInstances.filter((i) => i.pausedReason !== "lead_replied");

  // Policy: if an instance is paused due to a lead reply, re-enable it on the next outbound touch.
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
      return { updated: false, reason: "recent_inbound_activity" };
    }

    const startAt = outboundAt;
    let resumed = 0;

    for (const instance of pausedReplied) {
      const nextStep = await prisma.followUpStep.findFirst({
        where: { sequenceId: instance.sequenceId, stepOrder: { gt: instance.currentStep } },
        orderBy: { stepOrder: "asc" },
        select: { dayOffset: true, minuteOffset: true },
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
              select: { dayOffset: true, minuteOffset: true },
            })
          : null;

      // When resuming, schedule relative to this outbound touch while preserving the spacing between steps.
      const currentStepTiming = currentStepMeta ?? { dayOffset: 0, minuteOffset: 0 };
      const deltaMs = computeStepDeltaMs(currentStepTiming, nextStep);
      const nextStepDue = new Date(startAt.getTime() + deltaMs);
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
      return { updated: true, reason: "resumed_on_outbound", resumedCount: resumed };
    }
  }

  if (pausedInstances.length > 0) return { updated: false, reason: "instance_already_active" };

  // No active/paused instances to update
  return { updated: false, reason: "no_instances_to_update" };
}

/**
 * Phase 66: Deprecated - No longer auto-starts "No Response" sequences.
 *
 * This function now only handles outbound-touch scheduling for EXISTING follow-up instances
 * (reset timing on human outbound, resume paused instances). It never creates new No Response
 * sequence instances.
 *
 * The "Meeting Requested" sequence is now triggered by setter email reply instead
 * (see autoStartMeetingRequestedSequenceOnSetterEmailReply).
 */
export async function autoStartNoResponseSequenceOnOutbound(opts: {
  leadId: string;
  outboundAt?: Date;
}): Promise<{ started: boolean; reason?: string }> {
  // Handle outbound-touch scheduling for existing instances (reset timing, resume paused)
  const result = await handleOutboundTouchForFollowUps({
    leadId: opts.leadId,
    outboundAt: opts.outboundAt,
  }).catch(() => ({ updated: false, reason: "outbound_touch_error" as const, resumedCount: 0 }));

  // Map the result to the legacy return shape for backward compatibility
  if ("resumedCount" in result && result.resumedCount && result.resumedCount > 0) {
    // "resumed_on_outbound" was previously returned as { started: true }
    return { started: true, reason: "resumed_on_outbound" };
  }

  // Phase 66: No new No Response instances are created
  return { started: false, reason: result.reason ?? "auto_start_disabled" };
}

/**
 * Phase 66: Auto-start the Meeting Requested sequence when a setter sends their first manual email reply.
 *
 * This replaces the previous sentiment-based triggering. The sequence now starts when:
 * - A setter (user with sentByUserId) sends an outbound email
 * - This is the first setter email reply for this lead
 * - The lead meets eligibility criteria (positive context, no booking, auto-follow-up enabled)
 *
 * Scheduling is anchored to the email's `sentAt` timestamp so Day 0 steps fire relative to
 * the actual reply time (not wall-clock time when the job processes).
 */
export async function autoStartMeetingRequestedSequenceOnSetterEmailReply(opts: {
  leadId: string;
  messageId: string;
  outboundAt: Date;
  sentByUserId: string | null;
}): Promise<{ started: boolean; reason?: string }> {
  // Must be a manual send (from dashboard) not a system/auto send
  if (!opts.sentByUserId) {
    return { started: false, reason: "not_manual_sender" };
  }

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

  // Block known negatives - don't start sequences for leads we shouldn't contact
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

  if (!lead.autoFollowUpEnabled) {
    return { started: false, reason: "lead_auto_followup_disabled" };
  }

  // First setter email reply only — do not restart on subsequent replies
  const priorSetterReply = await prisma.message.findFirst({
    where: {
      leadId: lead.id,
      channel: "email",
      direction: "outbound",
      sentByUserId: { not: null },
      id: { not: opts.messageId }, // Exclude the current message
    },
    select: { id: true },
  });

  if (priorSetterReply) {
    return { started: false, reason: "not_first_setter_reply" };
  }

  // Find the Meeting Requested sequence
  const sequence = await prisma.followUpSequence.findFirst({
    where: { clientId: lead.clientId, name: MEETING_REQUESTED_SEQUENCE_NAME, isActive: true },
    select: { id: true },
  });

  if (!sequence) {
    return { started: false, reason: "sequence_not_found_or_inactive" };
  }

  // Check if instance already exists (don't double-start)
  const existingInstance = await prisma.followUpInstance.findUnique({
    where: { leadId_sequenceId: { leadId: lead.id, sequenceId: sequence.id } },
    select: { id: true, status: true },
  });

  if (existingInstance) {
    return { started: false, reason: "instance_exists" };
  }

  // Start the sequence anchored to the reply timestamp
  await startSequenceInstance(lead.id, sequence.id, { startedAt: opts.outboundAt });

  return { started: true };
}
