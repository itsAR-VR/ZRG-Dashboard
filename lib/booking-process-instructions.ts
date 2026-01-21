/**
 * Booking Process Instruction Builder (Phase 36e)
 *
 * Generates AI draft instructions based on the current booking process stage
 * for a lead/campaign combination. Uses wave-based progress tracking.
 *
 * Key semantics (per Phase 36h):
 * - Wave is global across channels (not per-channel reply count)
 * - Stage maps from wave number: stage = stages.find(wave) || lastStage
 * - Instructions vary by channel (SMS is limited, email/LinkedIn allow hyperlinks)
 * - Required qualification questions are always included when questions are enabled
 * - Booking link comes from workspace default (getBookingLink)
 */

import { prisma } from "@/lib/prisma";
import {
  getCurrentBookingStage,
  getOrCreateBookingProgress,
  shouldEscalateForMaxWaves,
  storeSelectedRequiredQuestions,
} from "@/lib/booking-progress";
import { getBookingLink } from "@/lib/meeting-booking-provider";
import {
  getEffectiveTemplate,
  renderTemplate,
  type BookingStageTemplates,
} from "@/lib/booking-stage-templates";
import type { BookingProcessStage, WorkspaceSettings } from "@prisma/client";

export type MessageChannel = "email" | "sms" | "linkedin";

export interface BookingProcessContext {
  leadId: string;
  channel: MessageChannel;
  workspaceSettings: WorkspaceSettings | null;
  clientId: string;
  availableSlots?: string[]; // Formatted slot labels for suggesting times
}

export interface BookingProcessInstructionsResult {
  instructions: string | null;
  requiresHumanReview: boolean;
  escalationReason?: string;
  stageNumber?: number;
  waveNumber?: number;
}

/**
 * Get booking process instructions for AI draft generation.
 *
 * Returns null instructions if:
 * - Lead has no campaign
 * - Campaign has no booking process
 * - Stage doesn't apply to this channel
 */
export async function getBookingProcessInstructions(
  context: BookingProcessContext
): Promise<BookingProcessInstructionsResult> {
  const { leadId, channel, workspaceSettings, clientId } = context;

  // Get lead with campaign info
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      emailCampaignId: true,
      emailCampaign: {
        select: {
          id: true,
          bookingProcessId: true,
        },
      },
    },
  });

  if (!lead?.emailCampaignId) {
    return { instructions: null, requiresHumanReview: false };
  }

  const emailCampaignId = lead.emailCampaignId;

  const existingProgress = await prisma.leadCampaignBookingProgress.findUnique({
    where: { leadId_emailCampaignId: { leadId, emailCampaignId } },
    select: { id: true, activeBookingProcessId: true },
  });

  // Freeze semantics:
  // - If progress exists, it is the source of truth (even if campaign assignment changed).
  // - If progress does not exist yet, only start tracking if the campaign currently has a booking process.
  if (!existingProgress) {
    if (!lead.emailCampaign?.bookingProcessId) {
      return { instructions: null, requiresHumanReview: false };
    }

    await getOrCreateBookingProgress({
      leadId,
      emailCampaignId,
      freezeBookingProcessId: lead.emailCampaign.bookingProcessId,
    });
  } else if (!existingProgress.activeBookingProcessId) {
    return { instructions: null, requiresHumanReview: false };
  }

  // Check if max waves exceeded (should escalate)
  const shouldEscalate = await shouldEscalateForMaxWaves({
    leadId,
    emailCampaignId,
  });

  if (shouldEscalate) {
    return {
      instructions: null,
      requiresHumanReview: true,
      escalationReason: "max_booking_attempts_exceeded",
    };
  }

  // Get current stage based on wave
  const stage = await getCurrentBookingStage({ leadId, emailCampaignId });

  if (!stage) {
    return { instructions: null, requiresHumanReview: false };
  }

  // Check if stage applies to this channel
  const channelApplies = isChannelEnabledForStage(stage, channel);
  if (!channelApplies) {
    return {
      instructions: null,
      requiresHumanReview: false,
      stageNumber: stage.stageNumber,
    };
  }

  // Build instructions
  const instructions = await buildStageInstructions(stage, {
    ...context,
    emailCampaignId,
  });

  // Get progress for wave info
  const progress = await prisma.leadCampaignBookingProgress.findUnique({
    where: { leadId_emailCampaignId: { leadId, emailCampaignId } },
    select: { currentWave: true },
  });

  return {
    instructions,
    requiresHumanReview: false,
    stageNumber: stage.stageNumber,
    waveNumber: progress?.currentWave ?? 1,
  };
}

/**
 * Check if channel is enabled for the stage.
 */
function isChannelEnabledForStage(
  stage: BookingProcessStage,
  channel: MessageChannel
): boolean {
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
 * Build instruction string for AI prompt based on stage configuration.
 * Uses per-stage templates when available (Phase 47k).
 */
async function buildStageInstructions(
  stage: BookingProcessStage,
  context: BookingProcessContext & { emailCampaignId: string }
): Promise<string | null> {
  const instructions: string[] = [];
  const { channel, workspaceSettings, clientId, availableSlots, leadId, emailCampaignId } = context;

  // Parse per-stage template overrides (Phase 47k)
  const templates = (stage.instructionTemplates as BookingStageTemplates | null) ?? null;

  // Booking link
  if (stage.includeBookingLink) {
    const bookingLink = await getBookingLink(clientId, workspaceSettings);

    if (bookingLink) {
      // SMS/LinkedIn always use plain URL (no true hyperlink support)
      if (channel === "sms" || channel === "linkedin" || stage.linkType === "PLAIN_URL") {
        const template = getEffectiveTemplate("bookingLinkPlainTemplate", templates);
        instructions.push(renderTemplate(template, { bookingLink }));
      } else {
        const template = getEffectiveTemplate("bookingLinkHyperlinkTemplate", templates);
        instructions.push(renderTemplate(template, { bookingLink }));
      }
    } else {
      // Explicitly prevent placeholder link hallucinations when no booking link is configured.
      const template = getEffectiveTemplate("noBookingLinkTemplate", templates);
      instructions.push(template);
      console.warn(
        `[BookingProcess] Stage ${stage.stageNumber} requests booking link but none configured for client ${clientId}`
      );
    }
  }

  // Suggested times
  if (stage.includeSuggestedTimes) {
    const numTimes = stage.numberOfTimesToSuggest || 3;

    if (availableSlots && availableSlots.length > 0) {
      const timesToOffer = availableSlots.slice(0, numTimes);
      const timesBullets = timesToOffer.map((t) => `  - ${t}`).join("\n");
      const template = getEffectiveTemplate("suggestedTimesWithSlotsTemplate", templates);
      instructions.push(renderTemplate(template, { numTimes: timesToOffer.length, timesBullets }));
    } else {
      const template = getEffectiveTemplate("suggestedTimesNoSlotsTemplate", templates);
      instructions.push(renderTemplate(template, { numTimes }));
    }
  }

  // Qualifying questions
  if (stage.includeQualifyingQuestions) {
    const { questions, selectedRequiredIds } = await getQualifyingQuestionsForStage(
      stage,
      workspaceSettings,
      channel,
      leadId,
      emailCampaignId
    );

    if (questions.length > 0) {
      if (questions.length === 1) {
        const template = getEffectiveTemplate("qualifyingQuestionOneTemplate", templates);
        instructions.push(renderTemplate(template, { question: questions[0] }));
      } else {
        const questionsBullets = questions.map((q) => `  - ${q}`).join("\n");
        const template = getEffectiveTemplate("qualifyingQuestionManyTemplate", templates);
        instructions.push(renderTemplate(template, { questionsBullets }));
      }

      // SMS paraphrase hint
      if (channel === "sms") {
        const template = getEffectiveTemplate("smsParaphraseHintTemplate", templates);
        instructions.push(template);
      }

      // Store selected required question IDs for analytics attribution
      if (selectedRequiredIds.length > 0) {
        storeSelectedRequiredQuestions({
          leadId,
          emailCampaignId,
          questionIds: selectedRequiredIds,
        }).catch(() => undefined);
      }
    }
  }

  // Timezone ask
  if (stage.includeTimezoneAsk) {
    const template = getEffectiveTemplate("timezoneAskTemplate", templates);
    instructions.push(template);
  }

  // Special instruction for potential early booking acceptance
  if (stage.includeSuggestedTimes && !stage.includeBookingLink) {
    const template = getEffectiveTemplate("earlyAcceptanceHintTemplate", templates);
    instructions.push(template);
  }

  if (instructions.length === 0) {
    return null;
  }

  // Format as a distinct section for the AI prompt using wrapper template
  const bullets = instructions.map((i) => `- ${i}`).join("\n");
  const wrapperTemplate = getEffectiveTemplate("stageBlockWrapperTemplate", templates);
  return renderTemplate(wrapperTemplate, { stageNumber: stage.stageNumber, bullets });
}

/**
 * Simple hash function for deterministic rotation.
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Get qualifying questions for the stage.
 * Includes both required questions AND stage-selected questions, deduplicated.
 *
 * For SMS: limits to max 2 required questions, using deterministic rotation
 * based on leadId + emailCampaignId hash (Phase 36i).
 */
async function getQualifyingQuestionsForStage(
  stage: BookingProcessStage,
  settings: WorkspaceSettings | null,
  channel: MessageChannel,
  leadId: string,
  emailCampaignId: string
): Promise<{ questions: string[]; selectedRequiredIds: string[] }> {
  if (!settings?.qualificationQuestions) {
    return { questions: [], selectedRequiredIds: [] };
  }

  let allQuestions: Array<{ id: string; question: string; required?: boolean }> = [];
  try {
    allQuestions = JSON.parse(settings.qualificationQuestions);
  } catch {
    return { questions: [], selectedRequiredIds: [] };
  }

  if (!Array.isArray(allQuestions)) {
    return { questions: [], selectedRequiredIds: [] };
  }

  // Get required questions (sorted by id for stable ordering)
  const requiredQuestions = allQuestions
    .filter((q) => q.required === true)
    .sort((a, b) => a.id.localeCompare(b.id));

  // Get stage-selected questions
  const stageSelectedIds = new Set(stage.qualificationQuestionIds || []);
  const stageSelectedQuestions = allQuestions.filter(
    (q) => stageSelectedIds.has(q.id) && q.required !== true // Exclude required (we add them separately)
  );

  // For SMS: apply deterministic rotation if more than 2 required questions
  let selectedRequired = requiredQuestions;
  const selectedRequiredIds: string[] = [];

  if (channel === "sms" && requiredQuestions.length > 2) {
    // Deterministic selection: pick 2 required questions using hash
    const hashKey = `${leadId}:${emailCampaignId}`;
    const startIndex = simpleHash(hashKey) % requiredQuestions.length;
    selectedRequired = [
      requiredQuestions[startIndex],
      requiredQuestions[(startIndex + 1) % requiredQuestions.length],
    ];
  }

  // Track which required question IDs were selected (for analytics attribution)
  for (const q of selectedRequired) {
    selectedRequiredIds.push(q.id);
  }

  // Combine: required first, then stage-selected (deduplicated)
  const combinedQuestions = [
    ...selectedRequired,
    ...stageSelectedQuestions,
  ];

  // Deduplicate by ID
  const seenIds = new Set<string>();
  const dedupedQuestions = combinedQuestions.filter((q) => {
    if (seenIds.has(q.id)) return false;
    seenIds.add(q.id);
    return true;
  });

  // For SMS: limit total questions to 2
  const finalQuestions = channel === "sms"
    ? dedupedQuestions.slice(0, 2)
    : dedupedQuestions;

  return {
    questions: finalQuestions.map((q) => q.question),
    selectedRequiredIds,
  };
}

/**
 * Determine if booking process instructions should be fetched for a lead.
 * Quick check before the full instruction generation.
 */
export async function hasBookingProcess(leadId: string): Promise<boolean> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      emailCampaign: {
        select: { bookingProcessId: true },
      },
    },
  });

  return Boolean(lead?.emailCampaign?.bookingProcessId);
}
