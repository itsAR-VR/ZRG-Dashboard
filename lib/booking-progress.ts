/**
 * Booking Process Wave Progress Tracking (Phase 36)
 *
 * Manages wave-based progress for leads assigned to booking processes.
 * Waves are global indices shared across channels - a wave can include
 * up to one outbound per channel (email/SMS/LinkedIn).
 *
 * Key semantics (per Phase 36h):
 * - Wave advances only after all stage-enabled channels have been sent (or skipped)
 * - Channel is sendable if lead has the required contact info
 * - SMS DND holds the wave (don't skip) until cleared or 72h timeout
 * - activeBookingProcessId is frozen on first outbound (don't change mid-stream)
 */

import { prisma, isPrismaUniqueConstraintError } from "@/lib/prisma";
import type {
  Lead,
  BookingProcess,
  BookingProcessStage,
  LeadCampaignBookingProgress,
} from "@prisma/client";
import { normalizeLinkedInUrl } from "@/lib/linkedin-utils";

export type MessageChannel = "email" | "sms" | "linkedin";

export interface BookingProgressWithProcess extends LeadCampaignBookingProgress {
  activeBookingProcess: (BookingProcess & { stages: BookingProcessStage[] }) | null;
}

type LeadChannelInfo = Pick<Lead, "email" | "phone" | "linkedinId" | "linkedinUrl">;

function getStageForWave(stages: BookingProcessStage[], waveNumber: number): BookingProcessStage | null {
  if (stages.length === 0) return null;
  const exact = stages.find((s) => s.stageNumber === waveNumber);
  return exact ?? stages[stages.length - 1] ?? null;
}

function getRequiredChannelsForStage(stage: BookingProcessStage, lead: LeadChannelInfo): MessageChannel[] {
  const required: MessageChannel[] = [];

  if (stage.applyToEmail && isChannelSendable(lead, "email")) {
    required.push("email");
  }
  if (stage.applyToSms && isChannelSendable(lead, "sms")) {
    required.push("sms");
  }
  if (stage.applyToLinkedin && isChannelSendable(lead, "linkedin")) {
    required.push("linkedin");
  }

  return required;
}

async function maybeAdvanceWaveIfComplete(params: {
  progress: LeadCampaignBookingProgress;
  lead: LeadChannelInfo;
  stages: BookingProcessStage[];
}): Promise<{ progress: LeadCampaignBookingProgress; waveAdvanced: boolean }> {
  const { progress, lead, stages } = params;

  const currentStage = getStageForWave(stages, progress.currentWave);
  if (!currentStage) return { progress, waveAdvanced: false };

  // Special case: SMS DND hold prevents wave advancement
  if (
    currentStage.applyToSms &&
    isChannelSendable(lead, "sms") &&
    !progress.waveSmsSent &&
    progress.smsDndHeldSince
  ) {
    return { progress, waveAdvanced: false };
  }

  const requiredChannels = getRequiredChannelsForStage(currentStage, lead);

  const allSent = requiredChannels.every((ch) => {
    switch (ch) {
      case "email":
        return progress.waveEmailSent;
      case "sms":
        return progress.waveSmsSent;
      case "linkedin":
        return progress.waveLinkedinSent;
    }
  });

  if (!allSent) {
    return { progress, waveAdvanced: false };
  }

  const advanced = await prisma.leadCampaignBookingProgress.update({
    where: { id: progress.id },
    data: {
      currentWave: { increment: 1 },
      waveEmailSent: false,
      waveSmsSent: false,
      waveLinkedinSent: false,
    },
  });

  return { progress: advanced, waveAdvanced: true };
}

async function advanceWaveWhileNoRequiredChannels(params: {
  progress: LeadCampaignBookingProgress;
  lead: LeadChannelInfo;
  stages: BookingProcessStage[];
}): Promise<LeadCampaignBookingProgress> {
  const { lead, stages } = params;

  let progress = params.progress;
  const maxSkips = Math.max(1, stages.length + 2);

  for (let i = 0; i < maxSkips; i++) {
    const stage = getStageForWave(stages, progress.currentWave);
    if (!stage) return progress;

    // Never auto-skip if a DND hold is active (even if other channels are missing).
    if (stage.applyToSms && isChannelSendable(lead, "sms") && progress.smsDndHeldSince && !progress.waveSmsSent) {
      return progress;
    }

    const requiredChannels = getRequiredChannelsForStage(stage, lead);
    if (requiredChannels.length > 0) {
      return progress;
    }

    // No sendable channels in this wave → skip forward (advance wave + reset sent flags).
    progress = await prisma.leadCampaignBookingProgress.update({
      where: { id: progress.id },
      data: {
        currentWave: { increment: 1 },
        waveEmailSent: false,
        waveSmsSent: false,
        waveLinkedinSent: false,
      },
    });
  }

  return progress;
}

/**
 * Get or create booking progress for a lead/campaign combination.
 * On first access, freezes the activeBookingProcessId from the campaign.
 */
export async function getOrCreateBookingProgress(params: {
  leadId: string;
  emailCampaignId: string;
  freezeBookingProcessId?: string; // If provided, set this as activeBookingProcessId
}): Promise<BookingProgressWithProcess> {
  const { leadId, emailCampaignId, freezeBookingProcessId } = params;

  // Try to find existing progress
  const existing = await prisma.leadCampaignBookingProgress.findUnique({
    where: {
      leadId_emailCampaignId: { leadId, emailCampaignId },
    },
    include: {
      activeBookingProcess: {
        include: { stages: { orderBy: { stageNumber: "asc" } } },
      },
    },
  });

  if (existing) {
    return existing;
  }

  // Create new progress row
  // If freezeBookingProcessId not provided, look up from campaign
  let bookingProcessId = freezeBookingProcessId;
  if (!bookingProcessId) {
    const campaign = await prisma.emailCampaign.findUnique({
      where: { id: emailCampaignId },
      select: { bookingProcessId: true },
    });
    bookingProcessId = campaign?.bookingProcessId ?? undefined;
  }

  try {
    const created = await prisma.leadCampaignBookingProgress.create({
      data: {
        leadId,
        emailCampaignId,
        activeBookingProcessId: bookingProcessId,
        currentWave: 1,
      },
      include: {
        activeBookingProcess: {
          include: { stages: { orderBy: { stageNumber: "asc" } } },
        },
      },
    });

    return created;
  } catch (error) {
    // Race condition: two workers created progress simultaneously.
    if (isPrismaUniqueConstraintError(error)) {
      const raced = await prisma.leadCampaignBookingProgress.findUnique({
        where: { leadId_emailCampaignId: { leadId, emailCampaignId } },
        include: {
          activeBookingProcess: {
            include: { stages: { orderBy: { stageNumber: "asc" } } },
          },
        },
      });

      if (raced) return raced;
    }

    throw error;
  }
}

/**
 * Get the current booking stage for a lead/campaign based on wave number.
 * Returns null if no booking process is assigned.
 */
export async function getCurrentBookingStage(params: {
  leadId: string;
  emailCampaignId: string;
}): Promise<BookingProcessStage | null> {
  const [progress, lead] = await Promise.all([
    getOrCreateBookingProgress(params),
    prisma.lead.findUnique({
      where: { id: params.leadId },
      select: { email: true, phone: true, linkedinId: true, linkedinUrl: true },
    }),
  ]);

  if (!progress.activeBookingProcess || !lead) {
    return null;
  }

  const { stages } = progress.activeBookingProcess;
  if (stages.length === 0) {
    return null;
  }

  const advancedProgress = await advanceWaveWhileNoRequiredChannels({
    progress,
    lead,
    stages,
  });

  // Find stage matching current wave, or use last stage if past defined stages
  const stage = getStageForWave(stages, advancedProgress.currentWave);
  return stage ?? stages[stages.length - 1];
}

/**
 * Check if a channel is sendable for a lead (has required contact info).
 */
export function isChannelSendable(
  lead: Pick<Lead, "email" | "phone" | "linkedinId" | "linkedinUrl">,
  channel: MessageChannel
): boolean {
  switch (channel) {
    case "email":
      return Boolean(lead.email);
    case "sms":
      return Boolean(lead.phone);
    case "linkedin":
      return Boolean(normalizeLinkedInUrl(lead.linkedinUrl));
  }
}

/**
 * Check if a channel is enabled for the current stage.
 */
export function isChannelEnabledForStage(
  stage: BookingProcessStage | null,
  channel: MessageChannel
): boolean {
  if (!stage) return false;

  switch (channel) {
    case "email":
      return stage.applyToEmail;
    case "sms":
      return stage.applyToSms;
    case "linkedin":
      return stage.applyToLinkedin;
  }
}

/**
 * Record an outbound message send for wave progress tracking.
 * Should be called AFTER the outbound Message row is successfully created.
 *
 * @param params.smsPartCount - For multipart SMS, the number of parts sent (1-3)
 */
export async function recordChannelSend(params: {
  leadId: string;
  emailCampaignId: string;
  channel: MessageChannel;
  smsPartCount?: number; // For multipart SMS (Phase 36i)
}): Promise<{
  progress: LeadCampaignBookingProgress;
  waveAdvanced: boolean;
}> {
  const { leadId, emailCampaignId, channel, smsPartCount = 1 } = params;

  // Get current progress and lead info
  const [progress, lead] = await Promise.all([
    getOrCreateBookingProgress({ leadId, emailCampaignId }),
    prisma.lead.findUnique({
      where: { id: leadId },
      select: { email: true, phone: true, linkedinId: true, linkedinUrl: true },
    }),
  ]);

  if (!lead) {
    return { progress, waveAdvanced: false };
  }

  // Build update data
  const now = new Date();
  const channelUpdateMap: Record<
    MessageChannel,
    { sentFlag: string; countField: string; timestampField: string }
  > = {
    email: {
      sentFlag: "waveEmailSent",
      countField: "emailOutboundCount",
      timestampField: "lastEmailOutboundAt",
    },
    sms: {
      sentFlag: "waveSmsSent",
      countField: "smsOutboundCount",
      timestampField: "lastSmsOutboundAt",
    },
    linkedin: {
      sentFlag: "waveLinkedinSent",
      countField: "linkedinOutboundCount",
      timestampField: "lastLinkedinOutboundAt",
    },
  };

  const channelFields = channelUpdateMap[channel];
  const incrementCount = channel === "sms" ? smsPartCount : 1;

  // Update progress: mark channel sent, increment count
  let updatedProgress = await prisma.leadCampaignBookingProgress.update({
    where: { id: progress.id },
    data: {
      [channelFields.sentFlag]: true,
      [channelFields.countField]: { increment: incrementCount },
      [channelFields.timestampField]: now,
      // Clear SMS DND hold if SMS was successfully sent
      ...(channel === "sms" && {
        smsDndHeldSince: null,
        smsDndLastRetryAt: null,
      }),
    },
  });

  // Check if wave is complete (uses the frozen active booking process for this lead/campaign)
  const stages = progress.activeBookingProcess?.stages ?? [];
  if (stages.length === 0) {
    return { progress: updatedProgress, waveAdvanced: false };
  }

  const advanced = await maybeAdvanceWaveIfComplete({
    progress: updatedProgress,
    lead,
    stages,
  });

  return advanced;
}

/**
 * Mark a channel as skipped for the current wave (e.g., no contact info).
 * This allows the wave to advance without that channel.
 */
export async function skipChannelForWave(params: {
  leadId: string;
  emailCampaignId: string;
  channel: MessageChannel;
}): Promise<LeadCampaignBookingProgress> {
  const { leadId, emailCampaignId, channel } = params;

  const [progress, lead] = await Promise.all([
    getOrCreateBookingProgress({ leadId, emailCampaignId }),
    prisma.lead.findUnique({
      where: { id: leadId },
      select: { email: true, phone: true, linkedinId: true, linkedinUrl: true },
    }),
  ]);

  if (!lead) {
    return progress;
  }

  const channelSentField: Record<MessageChannel, string> = {
    email: "waveEmailSent",
    sms: "waveSmsSent",
    linkedin: "waveLinkedinSent",
  };

  const updated = await prisma.leadCampaignBookingProgress.update({
    where: { id: progress.id },
    data: {
      [channelSentField[channel]]: true, // Mark as "sent" to allow wave advancement
      ...(channel === "sms" && {
        smsDndHeldSince: null,
        smsDndLastRetryAt: null,
      }),
    },
  });

  const stages = progress.activeBookingProcess?.stages ?? [];
  if (stages.length === 0) {
    return updated;
  }

  const advanced = await maybeAdvanceWaveIfComplete({
    progress: updated,
    lead,
    stages,
  });

  return advanced.progress;
}

/**
 * Handle SMS DND block by setting the hold timestamp.
 * Per Phase 36i: hold wave and retry every 2 hours until DND clears or 72h timeout.
 */
export async function holdWaveForSmsDnd(params: {
  leadId: string;
  emailCampaignId: string;
}): Promise<LeadCampaignBookingProgress> {
  const { leadId, emailCampaignId } = params;
  const progress = await getOrCreateBookingProgress({ leadId, emailCampaignId });
  const now = new Date();

  // Only set smsDndHeldSince if not already held
  if (!progress.smsDndHeldSince) {
    return prisma.leadCampaignBookingProgress.update({
      where: { id: progress.id },
      data: {
        smsDndHeldSince: now,
        smsDndLastRetryAt: now,
      },
    });
  }

  // Update retry timestamp
  return prisma.leadCampaignBookingProgress.update({
    where: { id: progress.id },
    data: {
      smsDndLastRetryAt: now,
    },
  });
}

/**
 * Check if SMS DND hold should be released (72h timeout).
 * If timeout exceeded, mark SMS as skipped so wave can advance.
 */
export async function checkSmsDndTimeout(params: {
  leadId: string;
  emailCampaignId: string;
}): Promise<{
  timedOut: boolean;
  progress: LeadCampaignBookingProgress;
}> {
  const { leadId, emailCampaignId } = params;
  const [progress, lead] = await Promise.all([
    getOrCreateBookingProgress({ leadId, emailCampaignId }),
    prisma.lead.findUnique({
      where: { id: leadId },
      select: { email: true, phone: true, linkedinId: true, linkedinUrl: true },
    }),
  ]);

  if (!progress.smsDndHeldSince) {
    return { timedOut: false, progress };
  }

  const holdDurationMs = Date.now() - progress.smsDndHeldSince.getTime();
  const timeoutMs = 72 * 60 * 60 * 1000; // 72 hours

  if (holdDurationMs >= timeoutMs) {
    // Timeout exceeded - skip SMS for this wave
    const updatedProgress = await prisma.leadCampaignBookingProgress.update({
      where: { id: progress.id },
      data: {
        waveSmsSent: true, // Mark as "sent" to allow wave advancement
        smsDndHeldSince: null,
        smsDndLastRetryAt: null,
      },
    });

    const stages = progress.activeBookingProcess?.stages ?? [];
    if (!lead || stages.length === 0) {
      return { timedOut: true, progress: updatedProgress };
    }

    const advanced = await maybeAdvanceWaveIfComplete({
      progress: updatedProgress,
      lead,
      stages,
    });

    return { timedOut: true, progress: advanced.progress };
  }

  return { timedOut: false, progress };
}

/**
 * Get leads with SMS DND holds that are due for retry (every 2 hours).
 */
export async function getSmsDndRetryDueLeads(
  clientId: string
): Promise<LeadCampaignBookingProgress[]> {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  return prisma.leadCampaignBookingProgress.findMany({
    where: {
      smsDndHeldSince: { not: null },
      OR: [
        { smsDndLastRetryAt: null },
        { smsDndLastRetryAt: { lt: twoHoursAgo } },
      ],
      lead: { clientId },
    },
  });
}

/**
 * Check if a lead/campaign has exceeded max waves (should escalate to human).
 */
export async function shouldEscalateForMaxWaves(params: {
  leadId: string;
  emailCampaignId: string;
}): Promise<boolean> {
  const progress = await prisma.leadCampaignBookingProgress.findUnique({
    where: {
      leadId_emailCampaignId: {
        leadId: params.leadId,
        emailCampaignId: params.emailCampaignId,
      },
    },
    include: {
      activeBookingProcess: {
        select: { maxWavesBeforeEscalation: true },
      },
    },
  });

  if (!progress?.activeBookingProcess) {
    return false;
  }

  return progress.currentWave > progress.activeBookingProcess.maxWavesBeforeEscalation;
}

/**
 * Store the selected required question IDs for this lead/campaign (for analytics attribution).
 */
export async function storeSelectedRequiredQuestions(params: {
  leadId: string;
  emailCampaignId: string;
  questionIds: string[];
}): Promise<void> {
  const { leadId, emailCampaignId, questionIds } = params;

  await prisma.leadCampaignBookingProgress.upsert({
    where: {
      leadId_emailCampaignId: { leadId, emailCampaignId },
    },
    create: {
      leadId,
      emailCampaignId,
      selectedRequiredQuestionIds: questionIds,
    },
    update: {
      selectedRequiredQuestionIds: questionIds,
    },
  });
}

// ----------------------------------------------------------------------------
// Outbound Send Integration Helpers (Phase 36 review fixes)
// ----------------------------------------------------------------------------

/**
 * Record an outbound message send for booking progress tracking.
 * This is a convenience wrapper that looks up the lead's campaign and
 * gracefully no-ops if the lead has no campaign or no booking process.
 *
 * Call this AFTER successfully creating an outbound Message row.
 */
export async function recordOutboundForBookingProgress(params: {
  leadId: string;
  channel: MessageChannel;
  smsPartCount?: number;
}): Promise<void> {
  const { leadId, channel, smsPartCount } = params;

  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        emailCampaignId: true,
        emailCampaign: {
          select: { bookingProcessId: true },
        },
      },
    });

    if (!lead?.emailCampaignId) {
      return;
    }

    const existingProgress = await prisma.leadCampaignBookingProgress.findUnique({
      where: { leadId_emailCampaignId: { leadId, emailCampaignId: lead.emailCampaignId } },
      select: { id: true, activeBookingProcessId: true },
    });

    // If progress exists, it is the source of truth (freeze semantics).
    if (!existingProgress) {
      // No progress row yet. If campaign has no booking process, do nothing.
      if (!lead.emailCampaign?.bookingProcessId) return;
    } else if (!existingProgress.activeBookingProcessId) {
      return;
    }

    const result = await recordChannelSend({
      leadId,
      emailCampaignId: lead.emailCampaignId,
      channel,
      smsPartCount,
    });

    if (result.waveAdvanced) {
      console.log(
        `[BookingProgress] Wave advanced to ${result.progress.currentWave} for lead ${leadId} (${channel})`
      );
    }
  } catch (error) {
    // Log but don't fail the send - booking progress is secondary
    console.error("[BookingProgress] Failed to record outbound:", error);
  }
}

/**
 * Handle SMS DND block for booking progress.
 * Call this when SMS send fails with DND error code.
 *
 * Gracefully no-ops if lead has no campaign or no booking process.
 */
export async function handleSmsDndForBookingProgress(params: {
  leadId: string;
}): Promise<void> {
  const { leadId } = params;

  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        emailCampaignId: true,
        emailCampaign: {
          select: { bookingProcessId: true },
        },
      },
    });

    if (!lead?.emailCampaignId) {
      return;
    }

    const existingProgress = await prisma.leadCampaignBookingProgress.findUnique({
      where: { leadId_emailCampaignId: { leadId, emailCampaignId: lead.emailCampaignId } },
      select: { id: true, activeBookingProcessId: true },
    });

    if (!existingProgress) {
      if (!lead.emailCampaign?.bookingProcessId) return;
    } else if (!existingProgress.activeBookingProcessId) {
      return;
    }

    await holdWaveForSmsDnd({
      leadId,
      emailCampaignId: lead.emailCampaignId,
    });

    console.log(
      `[BookingProgress] SMS DND hold set for lead ${leadId}`
    );
  } catch (error) {
    console.error("[BookingProgress] Failed to set SMS DND hold:", error);
  }
}
