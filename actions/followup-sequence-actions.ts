"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { isWorkspaceFollowUpsPaused } from "@/lib/workspace-followups-pause";
import { requireClientAccess, requireClientAdminAccess, requireLeadAccessById, resolveClientScope } from "@/lib/workspace-access";
import { ensureDefaultSequencesIncludeLinkedInStepsForClient } from "@/lib/followup-sequence-linkedin";
import { computeStepDeltaMs, computeStepOffsetMs } from "@/lib/followup-schedule";
import {
  FOLLOWUP_TEMPLATE_TOKEN_DEFINITIONS,
  extractFollowUpTemplateTokens,
  getUnknownFollowUpTemplateTokens,
  parseQualificationQuestions,
  type FollowUpTemplateValueKey,
} from "@/lib/followup-template";
import { validateSpintax } from "@/lib/spintax";
import { getBookingLink } from "@/lib/meeting-booking-provider";
import {
  MEETING_REQUESTED_SEQUENCE_NAME_LEGACY,
  MEETING_REQUESTED_SEQUENCE_NAMES,
  NO_RESPONSE_SEQUENCE_NAME,
  POST_BOOKING_SEQUENCE_NAME,
  ZRG_WORKFLOW_V1_SEQUENCE_NAME,
} from "@/lib/followup-sequence-names";

async function requireFollowUpInstanceAccess(instanceId: string): Promise<void> {
  const scope = await resolveClientScope(null);
  const instance = await prisma.followUpInstance.findFirst({
    where: { id: instanceId, lead: { clientId: { in: scope.clientIds } } },
    select: { id: true },
  });
  if (!instance) throw new Error("Unauthorized");
}

// =============================================================================
// Types
// =============================================================================

export interface FollowUpStepData {
  id?: string;
  stepOrder: number;
  dayOffset: number;
  minuteOffset?: number; // Minutes after dayOffset boundary (e.g., 2 = +2 min, 60 = +1 hour)
  channel: "email" | "sms" | "linkedin" | "ai_voice";
  messageTemplate: string | null;
  subject: string | null;
  condition: StepCondition | null;
  requiresApproval: boolean;
  fallbackStepId: string | null;
}

export interface StepCondition {
  type: "phone_provided" | "linkedin_connected" | "no_response" | "email_opened" | "always";
  value?: string;
}

export interface FollowUpSequenceData {
  id: string;
  name: string;
  description: string | null;
  clientId: string;
  isActive: boolean;
  triggerOn: "no_response" | "meeting_selected" | "manual" | "setter_reply";
  aiPersonaId: string | null;
  steps: FollowUpStepData[];
  createdAt: Date;
  updatedAt: Date;
}

export interface FollowUpInstanceData {
  id: string;
  leadId: string;
  leadName: string;
  leadEmail: string | null;
  sequenceId: string;
  sequenceName: string;
  currentStep: number;
  totalSteps: number;
  status: "active" | "paused" | "completed" | "cancelled";
  pausedReason: string | null;
  startedAt: Date;
  lastStepAt: Date | null;
  nextStepDue: Date | null;
  /**
   * Latest pending FollowUpTask linked to this instance (used to surface non-delivery warnings).
   * Null when no pending task exists.
   */
  latestTask: {
    id: string;
    type: string;
    dueDate: Date;
    suggestedMessage: string | null;
    stepOrder: number | null;
  } | null;
}

// =============================================================================
// Template Validation Helpers
// =============================================================================

type FollowUpStepTemplateInput = Pick<FollowUpStepData, "stepOrder" | "messageTemplate" | "subject">;

const TOKEN_DEFINITION_BY_TOKEN = new Map(
  FOLLOWUP_TEMPLATE_TOKEN_DEFINITIONS.map((definition) => [definition.token, definition])
);

function collectTemplateTokensFromSteps(steps: FollowUpStepTemplateInput[]): string[] {
  const tokens = new Set<string>();

  for (const step of steps) {
    for (const token of extractFollowUpTemplateTokens(step.messageTemplate)) tokens.add(token);
    for (const token of extractFollowUpTemplateTokens(step.subject)) tokens.add(token);
  }

  return Array.from(tokens);
}

function getUnknownTokenErrors(steps: FollowUpStepTemplateInput[]): string[] {
  const errors: string[] = [];

  steps.forEach((step, index) => {
    const unknown = new Set([
      ...getUnknownFollowUpTemplateTokens(step.messageTemplate),
      ...getUnknownFollowUpTemplateTokens(step.subject),
    ]);

    if (unknown.size > 0) {
      const stepLabel = Number.isFinite(step.stepOrder) ? step.stepOrder : index + 1;
      errors.push(`step ${stepLabel}: ${Array.from(unknown).join(", ")}`);
    }
  });

  return errors;
}

function getSpintaxErrors(steps: FollowUpStepTemplateInput[]): string[] {
  const errors: string[] = [];

  steps.forEach((step, index) => {
    const stepLabel = Number.isFinite(step.stepOrder) ? step.stepOrder : index + 1;
    const messageResult = validateSpintax(step.messageTemplate ?? "");
    if (!messageResult.ok) {
      errors.push(`step ${stepLabel} message: ${messageResult.error}`);
    }
    if (step.subject) {
      const subjectResult = validateSpintax(step.subject);
      if (!subjectResult.ok) {
        errors.push(`step ${stepLabel} subject: ${subjectResult.error}`);
      }
    }
  });

  return errors;
}

function getReferencedValueKeys(tokens: string[]): Set<FollowUpTemplateValueKey> {
  const keys = new Set<FollowUpTemplateValueKey>();

  for (const token of tokens) {
    const definition = TOKEN_DEFINITION_BY_TOKEN.get(token);
    if (definition) keys.add(definition.valueKey);
  }

  return keys;
}

async function getMissingWorkspaceSetup(
  clientId: string,
  tokens: string[],
  opts?: { aiPersonaId?: string | null }
): Promise<{ missing: string[]; bookingLink: string | null }> {
  const requiredKeys = getReferencedValueKeys(tokens);
  const missing: string[] = [];

  const [settings, persona] = await Promise.all([
    prisma.workspaceSettings.findUnique({
      where: { clientId },
      select: {
        aiPersonaName: true,
        aiSignature: true,
        companyName: true,
        targetResult: true,
        qualificationQuestions: true,
        meetingBookingProvider: true,
        calendlyEventTypeLink: true,
      },
    }),
    opts?.aiPersonaId
      ? prisma.aiPersona.findUnique({
          where: { id: opts.aiPersonaId },
          select: { personaName: true, signature: true },
        })
      : Promise.resolve(null),
  ]);

  const resolvedPersonaName = persona?.personaName?.trim() || settings?.aiPersonaName?.trim();
  if (requiredKeys.has("aiPersonaName") && !resolvedPersonaName) {
    missing.push("AI persona name");
  }

  const resolvedSignature = persona?.signature?.trim() || settings?.aiSignature?.trim();
  if (requiredKeys.has("signature") && !resolvedSignature) {
    missing.push("Signature");
  }

  if (requiredKeys.has("companyName") && !settings?.companyName?.trim()) {
    missing.push("Company name");
  }

  if (requiredKeys.has("targetResult") && !settings?.targetResult?.trim()) {
    missing.push("Target result");
  }

  const needsQualification =
    requiredKeys.has("qualificationQuestion1") || requiredKeys.has("qualificationQuestion2");
  if (needsQualification) {
    const questions = parseQualificationQuestions(settings?.qualificationQuestions ?? null);
    const hasQuestions = questions.some((question) => question.question?.trim().length > 0);
    if (!hasQuestions) missing.push("Qualification questions");
  }

  let bookingLink: string | null = null;
  if (requiredKeys.has("bookingLink")) {
    bookingLink = await getBookingLink(clientId, settings);
    if (!bookingLink) missing.push("Default calendar link");
  }

  return { missing, bookingLink };
}

// =============================================================================
// Sequence CRUD
// =============================================================================

/**
 * Get all follow-up sequences for a workspace
 */
export async function getFollowUpSequences(
  clientId: string
): Promise<{ success: boolean; data?: FollowUpSequenceData[]; error?: string }> {
  try {
    await requireClientAccess(clientId);
    const sequences = await prisma.followUpSequence.findMany({
      where: { clientId },
      include: {
        steps: {
          orderBy: { stepOrder: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const formattedSequences: FollowUpSequenceData[] = sequences.map((seq) => ({
      id: seq.id,
      name: seq.name,
      description: seq.description,
      clientId: seq.clientId,
      isActive: seq.isActive,
      triggerOn: seq.triggerOn as FollowUpSequenceData["triggerOn"],
      aiPersonaId: seq.aiPersonaId,
      steps: seq.steps.map((step) => ({
        id: step.id,
        stepOrder: step.stepOrder,
        dayOffset: step.dayOffset,
        minuteOffset: step.minuteOffset,
        channel: step.channel as FollowUpStepData["channel"],
        messageTemplate: step.messageTemplate,
        subject: step.subject,
        condition: step.condition ? (JSON.parse(step.condition) as StepCondition) : null,
        requiresApproval: step.requiresApproval,
        fallbackStepId: step.fallbackStepId,
      })),
      createdAt: seq.createdAt,
      updatedAt: seq.updatedAt,
    }));

    return { success: true, data: formattedSequences };
  } catch (error) {
    console.error("Failed to fetch follow-up sequences:", error);
    return { success: false, error: "Failed to fetch sequences" };
  }
}

/**
 * Get a single follow-up sequence by ID
 */
export async function getFollowUpSequence(
  sequenceId: string
): Promise<{ success: boolean; data?: FollowUpSequenceData; error?: string }> {
  try {
    const sequence = await prisma.followUpSequence.findUnique({
      where: { id: sequenceId },
      include: {
        steps: {
          orderBy: { stepOrder: "asc" },
        },
      },
    });

    if (!sequence) {
      return { success: false, error: "Sequence not found" };
    }
    await requireClientAccess(sequence.clientId);

    const formattedSequence: FollowUpSequenceData = {
      id: sequence.id,
      name: sequence.name,
      description: sequence.description,
      clientId: sequence.clientId,
      isActive: sequence.isActive,
      triggerOn: sequence.triggerOn as FollowUpSequenceData["triggerOn"],
      aiPersonaId: sequence.aiPersonaId,
      steps: sequence.steps.map((step) => ({
        id: step.id,
        stepOrder: step.stepOrder,
        dayOffset: step.dayOffset,
        minuteOffset: step.minuteOffset,
        channel: step.channel as FollowUpStepData["channel"],
        messageTemplate: step.messageTemplate,
        subject: step.subject,
        condition: step.condition ? (JSON.parse(step.condition) as StepCondition) : null,
        requiresApproval: step.requiresApproval,
        fallbackStepId: step.fallbackStepId,
      })),
      createdAt: sequence.createdAt,
      updatedAt: sequence.updatedAt,
    };

    return { success: true, data: formattedSequence };
  } catch (error) {
    console.error("Failed to fetch follow-up sequence:", error);
    return { success: false, error: "Failed to fetch sequence" };
  }
}

/**
 * Create a new follow-up sequence with steps
 */
export async function createFollowUpSequence(data: {
  clientId: string;
  name: string;
  description?: string;
  triggerOn?: "no_response" | "meeting_selected" | "manual" | "setter_reply";
  aiPersonaId?: string | null;
  steps: Omit<FollowUpStepData, "id">[];
  isActive?: boolean; // Phase 66: Added to support creating disabled sequences
}): Promise<{ success: boolean; sequenceId?: string; error?: string }> {
  try {
    await requireClientAdminAccess(data.clientId);

    if (data.aiPersonaId) {
      const persona = await prisma.aiPersona.findUnique({
        where: { id: data.aiPersonaId },
        select: { clientId: true },
      });
      if (!persona || persona.clientId !== data.clientId) {
        return { success: false, error: "Invalid persona for this workspace" };
      }
    }

    const unknownErrors = getUnknownTokenErrors(data.steps);
    if (unknownErrors.length > 0) {
      return {
        success: false,
        error: `Unknown template variables: ${unknownErrors.join(" | ")}`,
      };
    }
    const spintaxErrors = getSpintaxErrors(data.steps);
    if (spintaxErrors.length > 0) {
      return {
        success: false,
        error: `Invalid spintax: ${spintaxErrors.join(" | ")}`,
      };
    }

    const sequence = await prisma.followUpSequence.create({
      data: {
        clientId: data.clientId,
        name: data.name,
        description: data.description,
        triggerOn: data.triggerOn || "no_response",
        aiPersonaId: data.aiPersonaId ?? null,
        isActive: data.isActive ?? true,
        steps: {
          create: data.steps.map((step) => ({
            stepOrder: step.stepOrder,
            dayOffset: step.dayOffset,
            minuteOffset: step.minuteOffset ?? 0,
            channel: step.channel,
            messageTemplate: step.messageTemplate,
            subject: step.subject,
            condition: step.condition ? JSON.stringify(step.condition) : null,
            requiresApproval: step.requiresApproval,
            fallbackStepId: step.fallbackStepId,
          })),
        },
      },
    });

    revalidatePath("/");
    return { success: true, sequenceId: sequence.id };
  } catch (error) {
    console.error("Failed to create follow-up sequence:", error);
    return { success: false, error: "Failed to create sequence" };
  }
}

/**
 * Update a follow-up sequence and its steps
 */
export async function updateFollowUpSequence(
  sequenceId: string,
  data: {
    name?: string;
    description?: string;
    isActive?: boolean;
    triggerOn?: "no_response" | "meeting_selected" | "manual" | "setter_reply";
    aiPersonaId?: string | null;
    steps?: Omit<FollowUpStepData, "id">[];
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const existing = await prisma.followUpSequence.findUnique({
      where: { id: sequenceId },
      select: { clientId: true },
    });
    if (!existing) return { success: false, error: "Sequence not found" };
    await requireClientAdminAccess(existing.clientId);

    if (data.aiPersonaId !== undefined && data.aiPersonaId !== null) {
      const persona = await prisma.aiPersona.findUnique({
        where: { id: data.aiPersonaId },
        select: { clientId: true },
      });
      if (!persona || persona.clientId !== existing.clientId) {
        return { success: false, error: "Invalid persona for this workspace" };
      }
    }

    if (data.steps) {
      const unknownErrors = getUnknownTokenErrors(data.steps);
      if (unknownErrors.length > 0) {
        return {
          success: false,
          error: `Unknown template variables: ${unknownErrors.join(" | ")}`,
        };
      }
      const spintaxErrors = getSpintaxErrors(data.steps);
      if (spintaxErrors.length > 0) {
        return {
          success: false,
          error: `Invalid spintax: ${spintaxErrors.join(" | ")}`,
        };
      }
    }

    // If steps are provided, delete existing steps and recreate
    if (data.steps) {
      await prisma.followUpStep.deleteMany({
        where: { sequenceId },
      });
    }

    await prisma.followUpSequence.update({
      where: { id: sequenceId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.triggerOn && { triggerOn: data.triggerOn }),
        ...(data.aiPersonaId !== undefined && { aiPersonaId: data.aiPersonaId }),
        ...(data.steps && {
          steps: {
            create: data.steps.map((step) => ({
              stepOrder: step.stepOrder,
              dayOffset: step.dayOffset,
              minuteOffset: step.minuteOffset ?? 0,
              channel: step.channel,
              messageTemplate: step.messageTemplate,
              subject: step.subject,
              condition: step.condition ? JSON.stringify(step.condition) : null,
              requiresApproval: step.requiresApproval,
              fallbackStepId: step.fallbackStepId,
            })),
          },
        }),
      },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to update follow-up sequence:", error);
    return { success: false, error: "Failed to update sequence" };
  }
}

/**
 * Delete a follow-up sequence (cascades to steps and instances)
 */
export async function deleteFollowUpSequence(
  sequenceId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const existing = await prisma.followUpSequence.findUnique({
      where: { id: sequenceId },
      select: { clientId: true },
    });
    if (!existing) return { success: false, error: "Sequence not found" };
    await requireClientAdminAccess(existing.clientId);

    await prisma.followUpSequence.delete({
      where: { id: sequenceId },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to delete follow-up sequence:", error);
    return { success: false, error: "Failed to delete sequence" };
  }
}

/**
 * Toggle sequence active status
 */
export async function toggleSequenceActive(
  sequenceId: string
): Promise<{ success: boolean; isActive?: boolean; error?: string }> {
  try {
    const sequence = await prisma.followUpSequence.findUnique({
      where: { id: sequenceId },
      select: {
        isActive: true,
        clientId: true,
        aiPersonaId: true,
        steps: {
          select: {
            stepOrder: true,
            messageTemplate: true,
            subject: true,
          },
        },
      },
    });

    if (!sequence) {
      return { success: false, error: "Sequence not found" };
    }
    await requireClientAdminAccess(sequence.clientId);

    if (!sequence.isActive) {
      const unknownErrors = getUnknownTokenErrors(sequence.steps);
      if (unknownErrors.length > 0) {
        return {
          success: false,
          error: `Unknown template variables: ${unknownErrors.join(" | ")}`,
        };
      }
      const spintaxErrors = getSpintaxErrors(sequence.steps);
      if (spintaxErrors.length > 0) {
        return {
          success: false,
          error: `Invalid spintax: ${spintaxErrors.join(" | ")}`,
        };
      }

      const tokens = collectTemplateTokensFromSteps(sequence.steps);
      const { missing } = await getMissingWorkspaceSetup(sequence.clientId, tokens, {
        aiPersonaId: sequence.aiPersonaId,
      });
      if (missing.length > 0) {
        return {
          success: false,
          error: `Follow-up setup incomplete: ${missing.join(", ")}`,
        };
      }
    }

    const updated = await prisma.followUpSequence.update({
      where: { id: sequenceId },
      data: { isActive: !sequence.isActive },
    });

    revalidatePath("/");
    return { success: true, isActive: updated.isActive };
  } catch (error) {
    console.error("Failed to toggle sequence active status:", error);
    return { success: false, error: "Failed to toggle sequence" };
  }
}

// =============================================================================
// Instance Management
// =============================================================================

/**
 * Start a follow-up sequence for a lead
 */
export async function startFollowUpSequence(
  leadId: string,
  sequenceId: string
): Promise<{ success: boolean; instanceId?: string; error?: string }> {
  try {
    const { clientId: leadClientId } = await requireLeadAccessById(leadId);
    // Check if sequence exists and is active
    const sequence = await prisma.followUpSequence.findUnique({
      where: { id: sequenceId },
      include: {
        steps: {
          orderBy: { stepOrder: "asc" },
          take: 1,
        },
      },
    });

    if (!sequence) {
      return { success: false, error: "Sequence not found" };
    }
    if (sequence.clientId !== leadClientId) {
      return { success: false, error: "Sequence does not belong to this workspace" };
    }

    if (!sequence.isActive) {
      return { success: false, error: "Sequence is not active" };
    }

    // Check if lead already has this sequence running
    const existingInstance = await prisma.followUpInstance.findUnique({
      where: {
        leadId_sequenceId: { leadId, sequenceId },
      },
    });

    if (existingInstance && existingInstance.status === "active") {
      return { success: false, error: "Lead already has this sequence running" };
    }

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { client: { select: { settings: { select: { followUpsPausedUntil: true } } } } },
    });

    // Calculate first step due date
    const firstStep = sequence.steps[0];
    let nextStepDue = firstStep
      ? new Date(Date.now() + computeStepOffsetMs(firstStep))
      : null;

    // Manual starts are allowed while paused, but the first execution should not occur until after the pause.
    const pausedUntil = lead?.client.settings?.followUpsPausedUntil ?? null;
    if (
      nextStepDue &&
      pausedUntil &&
      isWorkspaceFollowUpsPaused({ followUpsPausedUntil: pausedUntil }) &&
      pausedUntil.getTime() > nextStepDue.getTime()
    ) {
      nextStepDue = pausedUntil;
    }

    // Create or update instance and ensure autoFollowUpEnabled is true
    // Without this, the cron job won't process the instance (processFollowUpsDue filters on autoFollowUpEnabled)
    const [instance] = await prisma.$transaction([
      prisma.followUpInstance.upsert({
        where: {
          leadId_sequenceId: { leadId, sequenceId },
        },
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
      }),
      // Enable autoFollowUpEnabled so the cron will process this instance
      prisma.lead.update({
        where: { id: leadId },
        data: { autoFollowUpEnabled: true },
      }),
    ]);

    revalidatePath("/");
    return { success: true, instanceId: instance.id };
  } catch (error) {
    console.error("Failed to start follow-up sequence:", error);
    return { success: false, error: "Failed to start sequence" };
  }
}

/**
 * Pause a follow-up instance
 */
export async function pauseFollowUpInstance(
  instanceId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireFollowUpInstanceAccess(instanceId);
    await prisma.followUpInstance.update({
      where: { id: instanceId },
      data: {
        status: "paused",
        pausedReason: reason || "manual",
      },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to pause follow-up instance:", error);
    return { success: false, error: "Failed to pause sequence" };
  }
}

/**
 * Resume a paused follow-up instance
 */
export async function resumeFollowUpInstance(
  instanceId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireFollowUpInstanceAccess(instanceId);
    const instance = await prisma.followUpInstance.findUnique({
      where: { id: instanceId },
      include: {
        sequence: {
          include: {
            steps: {
              orderBy: { stepOrder: "asc" },
            },
          },
        },
      },
    });

    if (!instance) {
      return { success: false, error: "Instance not found" };
    }

    // Resume with existing nextStepDue if it's still in the future; otherwise run ASAP.
    const nextStep = instance.sequence.steps.find(
      (s) => s.stepOrder > instance.currentStep
    );
    const now = new Date();
    const nextStepDue = nextStep ? (instance.nextStepDue && instance.nextStepDue > now ? instance.nextStepDue : now) : null;

    await prisma.followUpInstance.update({
      where: { id: instanceId },
      data: {
        status: "active",
        pausedReason: null,
        nextStepDue,
      },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to resume follow-up instance:", error);
    return { success: false, error: "Failed to resume sequence" };
  }
}

/**
 * Cancel a follow-up instance
 */
export async function cancelFollowUpInstance(
  instanceId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireFollowUpInstanceAccess(instanceId);
    await prisma.followUpInstance.update({
      where: { id: instanceId },
      data: {
        status: "cancelled",
        completedAt: new Date(),
      },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to cancel follow-up instance:", error);
    return { success: false, error: "Failed to cancel sequence" };
  }
}

/**
 * Get all active follow-up instances for a lead
 */
export async function getLeadFollowUpInstances(
  leadId: string
): Promise<{ success: boolean; data?: FollowUpInstanceData[]; error?: string }> {
  try {
    await requireLeadAccessById(leadId);
    const instances = await prisma.followUpInstance.findMany({
      where: { leadId },
      include: {
        lead: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        sequence: {
          include: {
            steps: true,
          },
        },
      },
      orderBy: { startedAt: "desc" },
    });

    const instanceIds = instances.map((inst) => inst.id);
    const latestTaskByInstance = new Map<string, FollowUpInstanceData["latestTask"]>();

    if (instanceIds.length > 0) {
      const pendingTasks = await prisma.followUpTask.findMany({
        where: { instanceId: { in: instanceIds }, status: "pending" },
        select: {
          id: true,
          instanceId: true,
          type: true,
          dueDate: true,
          suggestedMessage: true,
          stepOrder: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
      });

      for (const task of pendingTasks) {
        if (!task.instanceId) continue;
        if (latestTaskByInstance.has(task.instanceId)) continue;
        latestTaskByInstance.set(task.instanceId, {
          id: task.id,
          type: task.type,
          dueDate: task.dueDate,
          suggestedMessage: task.suggestedMessage,
          stepOrder: task.stepOrder,
        });
      }
    }

    const formattedInstances: FollowUpInstanceData[] = instances.map((inst) => ({
      id: inst.id,
      leadId: inst.leadId,
      leadName: [inst.lead.firstName, inst.lead.lastName].filter(Boolean).join(" ") || "Unknown",
      leadEmail: inst.lead.email,
      sequenceId: inst.sequenceId,
      sequenceName: inst.sequence.name,
      currentStep: inst.currentStep,
      totalSteps: inst.sequence.steps.length,
      status: inst.status as FollowUpInstanceData["status"],
      pausedReason: inst.pausedReason,
      startedAt: inst.startedAt,
      lastStepAt: inst.lastStepAt,
      nextStepDue: inst.nextStepDue,
      latestTask: latestTaskByInstance.get(inst.id) ?? null,
    }));

    return { success: true, data: formattedInstances };
  } catch (error) {
    console.error("Failed to fetch lead follow-up instances:", error);
    return { success: false, error: "Failed to fetch instances" };
  }
}

/**
 * Get all active follow-up instances for a workspace (for follow-ups view)
 */
export async function getWorkspaceFollowUpInstances(
  clientId: string,
  filter?: "active" | "paused" | "completed" | "all"
): Promise<{ success: boolean; data?: FollowUpInstanceData[]; error?: string }> {
  try {
    await requireClientAccess(clientId);
    const whereClause: any = {
      sequence: { clientId },
    };

    if (filter && filter !== "all") {
      whereClause.status = filter;
    }

    const instances = await prisma.followUpInstance.findMany({
      where: whereClause,
      include: {
        lead: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        sequence: {
          include: {
            steps: true,
          },
        },
      },
      orderBy: [
        { nextStepDue: "asc" },
        { startedAt: "desc" },
      ],
    });

    const instanceIds = instances.map((inst) => inst.id);
    const latestTaskByInstance = new Map<string, FollowUpInstanceData["latestTask"]>();

    if (instanceIds.length > 0) {
      const pendingTasks = await prisma.followUpTask.findMany({
        where: { instanceId: { in: instanceIds }, status: "pending" },
        select: {
          id: true,
          instanceId: true,
          type: true,
          dueDate: true,
          suggestedMessage: true,
          stepOrder: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
      });

      for (const task of pendingTasks) {
        if (!task.instanceId) continue;
        if (latestTaskByInstance.has(task.instanceId)) continue;
        latestTaskByInstance.set(task.instanceId, {
          id: task.id,
          type: task.type,
          dueDate: task.dueDate,
          suggestedMessage: task.suggestedMessage,
          stepOrder: task.stepOrder,
        });
      }
    }

    const formattedInstances: FollowUpInstanceData[] = instances.map((inst) => ({
      id: inst.id,
      leadId: inst.leadId,
      leadName: [inst.lead.firstName, inst.lead.lastName].filter(Boolean).join(" ") || "Unknown",
      leadEmail: inst.lead.email,
      sequenceId: inst.sequenceId,
      sequenceName: inst.sequence.name,
      currentStep: inst.currentStep,
      totalSteps: inst.sequence.steps.length,
      status: inst.status as FollowUpInstanceData["status"],
      pausedReason: inst.pausedReason,
      startedAt: inst.startedAt,
      lastStepAt: inst.lastStepAt,
      nextStepDue: inst.nextStepDue,
      latestTask: latestTaskByInstance.get(inst.id) ?? null,
    }));

    return { success: true, data: formattedInstances };
  } catch (error) {
    console.error("Failed to fetch workspace follow-up instances:", error);
    return { success: false, error: "Failed to fetch instances" };
  }
}

/**
 * Get follow-up instances due for processing (called by cron)
 */
export async function getDueFollowUpInstances(): Promise<{
  success: boolean;
  data?: Array<{
    instanceId: string;
    leadId: string;
    sequenceId: string;
    currentStep: number;
    stepData: FollowUpStepData | null;
  }>;
  error?: string;
}> {
  try {
    const now = new Date();

    const instances = await prisma.followUpInstance.findMany({
      where: {
        status: "active",
        nextStepDue: { lte: now },
      },
      include: {
        sequence: {
          include: {
            steps: {
              orderBy: { stepOrder: "asc" },
            },
          },
        },
      },
    });

    const dueInstances = instances.map((inst) => {
      const nextStep = inst.sequence.steps.find(
        (s) => s.stepOrder > inst.currentStep
      );

      return {
        instanceId: inst.id,
        leadId: inst.leadId,
        sequenceId: inst.sequenceId,
        currentStep: inst.currentStep,
        stepData: nextStep
          ? {
            id: nextStep.id,
            stepOrder: nextStep.stepOrder,
            dayOffset: nextStep.dayOffset,
            minuteOffset: nextStep.minuteOffset,
            channel: nextStep.channel as FollowUpStepData["channel"],
            messageTemplate: nextStep.messageTemplate,
            subject: nextStep.subject,
            condition: nextStep.condition
              ? (JSON.parse(nextStep.condition) as StepCondition)
              : null,
            requiresApproval: nextStep.requiresApproval,
            fallbackStepId: nextStep.fallbackStepId,
          }
          : null,
      };
    });

    return { success: true, data: dueInstances };
  } catch (error) {
    console.error("Failed to fetch due follow-up instances:", error);
    return { success: false, error: "Failed to fetch due instances" };
  }
}

/**
 * Advance an instance to the next step after execution
 */
export async function advanceFollowUpInstance(
  instanceId: string
): Promise<{ success: boolean; completed?: boolean; error?: string }> {
  try {
    const instance = await prisma.followUpInstance.findUnique({
      where: { id: instanceId },
      include: {
        sequence: {
          include: {
            steps: {
              orderBy: { stepOrder: "asc" },
            },
          },
        },
      },
    });

    if (!instance) {
      return { success: false, error: "Instance not found" };
    }

    const currentStepIndex = instance.sequence.steps.findIndex(
      (s) => s.stepOrder > instance.currentStep
    );
    const currentStep = instance.sequence.steps[currentStepIndex];
    const nextStep = instance.sequence.steps[currentStepIndex + 1];

    if (!nextStep) {
      // Sequence completed
      await prisma.followUpInstance.update({
        where: { id: instanceId },
        data: {
          currentStep: currentStep?.stepOrder || instance.currentStep,
          lastStepAt: new Date(),
          nextStepDue: null,
          status: "completed",
          completedAt: new Date(),
        },
      });

      revalidatePath("/");
      return { success: true, completed: true };
    }

    const currentTiming = { dayOffset: currentStep?.dayOffset ?? 0, minuteOffset: currentStep?.minuteOffset ?? 0 };
    const nextTiming = { dayOffset: nextStep.dayOffset, minuteOffset: nextStep.minuteOffset ?? 0 };
    const deltaMs = computeStepDeltaMs(currentTiming, nextTiming);
    const nextStepDue = new Date(Date.now() + deltaMs);

    await prisma.followUpInstance.update({
      where: { id: instanceId },
      data: {
        currentStep: currentStep?.stepOrder || instance.currentStep,
        lastStepAt: new Date(),
        nextStepDue,
      },
    });

    revalidatePath("/");
    return { success: true, completed: false };
  } catch (error) {
    console.error("Failed to advance follow-up instance:", error);
    return { success: false, error: "Failed to advance instance" };
  }
}

// =============================================================================
// Default Sequence Templates
// =============================================================================

	const DEFAULT_SEQUENCE_NAMES = {
	  noResponse: NO_RESPONSE_SEQUENCE_NAME,
	  // Keep legacy name here for backward compatibility; runtime logic treats both names as the same workflow.
	  meetingRequested: MEETING_REQUESTED_SEQUENCE_NAME_LEGACY,
	  postBooking: POST_BOOKING_SEQUENCE_NAME,
	} as const;

	async function getMeetingRequestedSequenceNameForClient(clientId: string): Promise<string> {
	  const settings = await prisma.workspaceSettings.findUnique({
	    where: { clientId },
	    select: { brandName: true },
	  });

	  // ZRG workspaces are identified by `WorkspaceSettings.brandName IS NULL`.
	  // Branded workspaces (e.g. Founders Club) keep the legacy display name.
	  if (!settings || settings.brandName == null) return ZRG_WORKFLOW_V1_SEQUENCE_NAME;
	  return MEETING_REQUESTED_SEQUENCE_NAME_LEGACY;
	}

async function isAirtableModeEnabled(clientId: string): Promise<boolean> {
  const settings = await prisma.workspaceSettings.findUnique({
    where: { clientId },
    select: { airtableMode: true },
  });
  return settings?.airtableMode === true;
}

function stripEmailSteps(steps: Omit<FollowUpStepData, "id">[]): Omit<FollowUpStepData, "id">[] {
  const filtered = steps.filter((s) => s.channel !== "email");
  return filtered.map((step, idx) => ({ ...step, stepOrder: idx + 1 }));
}

async function isLinkedInConfigured(clientId: string): Promise<boolean> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { unipileAccountId: true },
  });
  return Boolean(client?.unipileAccountId);
}

function defaultNoResponseLinkedInSteps(): Array<Omit<FollowUpStepData, "id">> {
  return [
    // DAY 2 - LinkedIn follow-up (only if connected)
    // Per canonical doc: "Check to see whether they have connected on LinkedIn yet - follow up on there if so"
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

function defaultMeetingRequestedLinkedInSteps(): Array<Omit<FollowUpStepData, "id">> {
  return [
    // DAY 1 - LinkedIn connection request (1 hour after setter's reply)
    // Phase 66: Now relative to setter's first email reply (not a Day 0 auto-email)
    {
      stepOrder: 1, // temporary; will be renumbered
      dayOffset: 1,
      minuteOffset: 60, // 1 hour after setter's reply
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

function sortStepsForScheduling<T extends { dayOffset: number; minuteOffset?: number; channel: string }>(steps: T[]): T[] {
  const priority: Record<string, number> = {
    email: 1,
    sms: 2,
    linkedin: 3,
    ai_voice: 4,
  };
  return [...steps].sort((a, b) => {
    const dayDiff = a.dayOffset - b.dayOffset;
    if (dayDiff !== 0) return dayDiff;
    const minDiff = (a.minuteOffset ?? 0) - (b.minuteOffset ?? 0);
    if (minDiff !== 0) return minDiff;
    return (priority[a.channel] ?? 999) - (priority[b.channel] ?? 999);
  });
}

/**
 * Create the default "No Response" Day 2/5/7 follow-up sequence for a workspace.
 *
 * Phase 66: Created **disabled** by default. The No Response auto-start trigger has been deprecated
 * (see autoStartNoResponseSequenceOnOutbound). This sequence is preserved for manual use or future
 * reactivation, but won't auto-start on outbound touches.
 */
export async function createDefaultSequence(
  clientId: string
): Promise<{ success: boolean; sequenceId?: string; error?: string }> {
  await requireClientAdminAccess(clientId);
  const noResponseSteps: Omit<FollowUpStepData, "id">[] = [
    // DAY 2 - Ask for phone number
    // Per canonical doc: "Hi {FIRST_NAME} could I get the best number to reach you on so we can give you a call?"
    {
      stepOrder: 1,
      dayOffset: 2,
      minuteOffset: 0,
      channel: "email",
      messageTemplate: `Hi {FIRST_NAME} could I get the best number to reach you on so we can give you a call?`,
      subject: "Quick question",
      condition: { type: "always" },
      requiresApproval: false,
      fallbackStepId: null,
    },
    // DAY 2 - SMS fallback asking for good time to call
    {
      stepOrder: 2,
      dayOffset: 2,
      minuteOffset: 0,
      channel: "sms",
      messageTemplate: `Hey {FIRST_NAME}, when is a good time to give you a call?`,
      subject: null,
      condition: { type: "phone_provided" },
      requiresApproval: false,
      fallbackStepId: null,
    },
    // DAY 5 - Email with availability (in case they were busy)
    {
      stepOrder: 3,
      dayOffset: 5,
      minuteOffset: 0,
      channel: "email",
      messageTemplate: `Hi {FIRST_NAME}, just had time to get back to you.

I’m currently reviewing the slots I have left for new clients and just wanted to give you a fair shot in case you were still interested in {achieving result}. 

No problem if not but just let me know. I have {x day x time} and {y day y time} and if it’s easier here’s my calendar link for you to choose a time that works for you: {link}`,
      subject: "Re: Quick question",
      condition: { type: "always" },
      requiresApproval: false,
      fallbackStepId: null,
    },
    // DAY 5 - SMS with times
    {
      stepOrder: 4,
      dayOffset: 5,
      minuteOffset: 0,
      channel: "sms",
      messageTemplate: `Hey {FIRST_NAME} - {name} from {company} again

Just sent over an email about getting {result} 

I have {x day x time} and {y day y time} for you

Here’s the link to choose a time to talk if those don’t work  {link}`,
      subject: null,
      condition: { type: "phone_provided" },
      requiresApproval: false,
      fallbackStepId: null,
    },
    // DAY 7 - Final email
    {
      stepOrder: 5,
      dayOffset: 7,
      minuteOffset: 0,
      channel: "email",
      messageTemplate: `Hey {{contact.first_name}}, tried to reach you a few times but didn’t hear back….

Where should we go from here?`,
      subject: "Re: Quick question",
      condition: { type: "always" },
      requiresApproval: false,
      fallbackStepId: null,
    },
    // DAY 7 - Final SMS
    {
      stepOrder: 6,
      dayOffset: 7,
      minuteOffset: 0,
      channel: "sms",
      messageTemplate: `Hey {{contact.first_name}}, tried to reach you a few times but didn’t hear back….

Where should we go from here?`,
      subject: null,
      condition: { type: "phone_provided" },
      requiresApproval: false,
      fallbackStepId: null,
    },
  ];

  const airtableMode = await isAirtableModeEnabled(clientId);
  const hasLinkedIn = await isLinkedInConfigured(clientId);
  const baseSteps = airtableMode ? stripEmailSteps(noResponseSteps) : noResponseSteps;
  const steps = (() => {
    if (!hasLinkedIn) return baseSteps;
    const augmented = sortStepsForScheduling([...baseSteps, ...defaultNoResponseLinkedInSteps()]);
    return augmented.map((s, idx) => ({ ...s, stepOrder: idx + 1 }));
  })();

  // Phase 66: Created disabled by default (No Response auto-start is deprecated)
  return createFollowUpSequence({
    clientId,
    name: DEFAULT_SEQUENCE_NAMES.noResponse,
    description: "Triggered when lead doesn't respond: Day 2 (ask for phone), Day 5 (availability reminder), Day 7 (final check-in). NOTE: Auto-start disabled in Phase 66.",
    triggerOn: "no_response",
    steps,
    isActive: false, // Phase 66: No Response auto-start is deprecated
  });
}

/**
 * Create the default "Meeting Requested" sequence for a workspace.
 *
 * Phase 66: Now triggered when setter sends their first email reply (not on sentiment change).
 * The setter's manual reply IS the first touchpoint, so there's no Day 1 auto-email step.
 */
export async function createMeetingRequestedSequence(
  clientId: string
): Promise<{ success: boolean; sequenceId?: string; error?: string }> {
  await requireClientAdminAccess(clientId);
  const hasLinkedIn = await isLinkedInConfigured(clientId);
  const sequenceName = await getMeetingRequestedSequenceNameForClient(clientId);

  // Phase 66: Removed Day 1 auto-email step. The setter's manual reply is the first touchpoint.
  // Day 1 now starts with SMS (+2 min after setter reply) and LinkedIn connect (+1 hour).
  const steps: Omit<FollowUpStepData, "id">[] = [
    // DAY 1 - SMS (2 minute delay after setter's reply)
    {
      stepOrder: 1,
      dayOffset: 1,
      minuteOffset: 2,
      channel: "sms",
      messageTemplate: `Hi {FIRST_NAME}, it’s {name} from {company}, I just sent over an email but wanted to drop a text too incase it went to spam - here’s the link {link}`,
      subject: null,
      condition: { type: "phone_provided" },
      requiresApproval: false,
      fallbackStepId: null,
    },
    // DAY 2 - Email
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
    // DAY 5 - Email
    {
      stepOrder: 4,
      dayOffset: 5,
      minuteOffset: 0,
      channel: "email",
      messageTemplate: `Hi {FIRST_NAME}, just had time to get back to you.

I’m currently reviewing the slots I have left for new clients and just wanted to give you a fair shot in case you were still interested in {achieving result}. 

No problem if not but just let me know. I have {x day x time} and {y day y time} and if it’s easier here’s my calendar link for you to choose a time that works for you: {link}`,
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

Here’s the link to choose a time to talk if those don’t work  {link}`,
      subject: null,
      condition: { type: "phone_provided" },
      requiresApproval: false,
      fallbackStepId: null,
    },
    // DAY 7 - Email
    {
      stepOrder: 6,
      dayOffset: 7,
      minuteOffset: 0,
      channel: "email",
      messageTemplate: `Hey {{contact.first_name}}, tried to reach you a few times but didn’t hear back….

Where should we go from here?`,
      subject: "Re: Scheduling a quick call",
      condition: { type: "always" },
      requiresApproval: false,
      fallbackStepId: null,
    },
    // DAY 7 - SMS (only if phone provided)
    {
      stepOrder: 7,
      dayOffset: 7,
      minuteOffset: 0,
      channel: "sms",
      messageTemplate: `Hey {{contact.first_name}}, tried to reach you a few times but didn’t hear back….

Where should we go from here?`,
      subject: null,
      condition: { type: "phone_provided" },
      requiresApproval: false,
      fallbackStepId: null,
    },
  ];

  const airtableMode = await isAirtableModeEnabled(clientId);
  const withOptionalLinkedIn = hasLinkedIn
    ? sortStepsForScheduling([...steps, ...defaultMeetingRequestedLinkedInSteps()]).map((s, idx) => ({
      ...s,
      stepOrder: idx + 1,
    }))
    : steps;
  const filteredSteps = airtableMode ? stripEmailSteps(withOptionalLinkedIn) : withOptionalLinkedIn;

  // Phase 66: Updated description to reflect setter-reply trigger
  const description = hasLinkedIn
    ? 'Triggered when setter sends first email reply: Day 1 (SMS + LinkedIn connect), Day 2 (Email + SMS + LinkedIn DM if connected), Day 5 (reminder), Day 7 (final check-in)'
    : 'Triggered when setter sends first email reply: Day 1 (SMS), Day 2 (Email + SMS), Day 5 (reminder), Day 7 (final check-in)';

  return createFollowUpSequence({
    clientId,
    name: sequenceName,
    description,
    triggerOn: "manual",
    steps: filteredSteps,
  });
}

export async function ensureDefaultSequencesIncludeLinkedInSteps(
  clientId: string
): Promise<{ success: boolean; updated?: number; error?: string }> {
  try {
    await requireClientAdminAccess(clientId);
    const hasLinkedIn = await isLinkedInConfigured(clientId);
    if (!hasLinkedIn) return { success: true, updated: 0 };
    const result = await ensureDefaultSequencesIncludeLinkedInStepsForClient({ prisma, clientId });
    revalidatePath("/");
    return { success: true, updated: result.updatedSequences };
  } catch (error) {
    console.error("Failed to ensure LinkedIn steps on default sequences:", error);
    return { success: false, error: "Failed to update default sequences" };
  }
}

/**
 * Create the "Post-Booking Qualification" sequence for a workspace
 * Triggered after lead selects a meeting time
 */
export async function createPostBookingSequence(
  clientId: string
): Promise<{ success: boolean; sequenceId?: string; error?: string }> {
  await requireClientAdminAccess(clientId);
  const postBookingSteps: Omit<FollowUpStepData, "id">[] = [
    // DAY 0 - Booking confirmation + qualification questions
    // Per canonical doc
    {
      stepOrder: 1,
      dayOffset: 0,
      minuteOffset: 0,
      channel: "email",
      messageTemplate: `Great I’ve booked you in and you should get a reminder to your email.

Before the call would you be able to let me know {qualification question 1} and {qualification question 2} just so I’m able to prepare properly for the call.`,
      subject: "You're booked in!",
      condition: { type: "always" },
      requiresApproval: false,
      fallbackStepId: null,
    },
  ];

  const airtableMode = await isAirtableModeEnabled(clientId);
  if (airtableMode) {
    return { success: false, error: "Post-booking default sequence is email-only and is disabled in Airtable Mode" };
  }

  return createFollowUpSequence({
    clientId,
    name: DEFAULT_SEQUENCE_NAMES.postBooking,
    description: "Triggered after meeting booked: Confirmation + request qualification info",
    triggerOn: "meeting_selected",
    steps: postBookingSteps,
  });
}

/**
 * Create both default sequences for a workspace
 */
export async function createAllDefaultSequences(
  clientId: string
): Promise<{ success: boolean; sequenceIds?: string[]; errors?: string[] }> {
  await requireClientAdminAccess(clientId);
  const airtableMode = await isAirtableModeEnabled(clientId);

  const results = await Promise.all([
    createDefaultSequence(clientId),
    createMeetingRequestedSequence(clientId),
    ...(airtableMode ? [] : [createPostBookingSequence(clientId)]),
  ]);

  const sequenceIds: string[] = [];
  const errors: string[] = [];

  for (const result of results) {
    if (result.success && result.sequenceId) {
      sequenceIds.push(result.sequenceId);
    } else if (result.error) {
      errors.push(result.error);
    }
  }

  return {
    success: errors.length === 0,
    sequenceIds: sequenceIds.length > 0 ? sequenceIds : undefined,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export async function applyAirtableModeToDefaultSequences(opts: {
  clientId: string;
  enabled: boolean;
}): Promise<{ success: boolean; updated?: number; error?: string }> {
  try {
    if (!opts.clientId) {
      return { success: false, error: "No workspace selected" };
    }
    await requireClientAdminAccess(opts.clientId);

    if (!opts.enabled) {
      // NOTE: We intentionally do not attempt to restore email steps automatically.
      // That would require re-templating and could overwrite user edits.
      return { success: true, updated: 0 };
    }

    const hasLinkedIn = await isLinkedInConfigured(opts.clientId);

	    const sequences = await prisma.followUpSequence.findMany({
	      where: {
	        clientId: opts.clientId,
	        name: { in: [DEFAULT_SEQUENCE_NAMES.noResponse, ...MEETING_REQUESTED_SEQUENCE_NAMES] },
	      },
	      include: { steps: { orderBy: { stepOrder: "asc" } } },
	    });

    let updated = 0;

    for (const sequence of sequences) {
      const original = sequence.steps;
      const baseExisting = original.filter((s) => s.channel !== "email");
      const hasEmailSteps = baseExisting.length !== original.length;
      const hasLinkedInSteps = baseExisting.some((s) => s.channel === "linkedin");
      const shouldAddNoResponseLinkedIn =
        sequence.name === DEFAULT_SEQUENCE_NAMES.noResponse && hasLinkedIn && !hasLinkedInSteps;
      const shouldMutate = hasEmailSteps || shouldAddNoResponseLinkedIn;
      if (!shouldMutate) continue;

      await prisma.$transaction(async (tx) => {
        const toCreate = shouldAddNoResponseLinkedIn ? defaultNoResponseLinkedInSteps() : [];

        const desired = sortStepsForScheduling([
          ...baseExisting.map((s) => ({
            kind: "existing" as const,
            id: s.id,
            oldStepOrder: s.stepOrder,
            dayOffset: s.dayOffset,
            channel: s.channel,
            messageTemplate: s.messageTemplate,
            subject: s.subject,
            condition: s.condition,
            requiresApproval: s.requiresApproval,
            fallbackStepId: s.fallbackStepId,
          })),
          ...toCreate.map((s) => ({
            kind: "new" as const,
            dayOffset: s.dayOffset,
            channel: s.channel,
            messageTemplate: s.messageTemplate,
            subject: s.subject,
            condition: s.condition,
            requiresApproval: s.requiresApproval,
            fallbackStepId: s.fallbackStepId,
          })),
        ]);

        // Capture old stepOrder values BEFORE we change anything in the DB.
        // We use this snapshot to remap in-flight FollowUpInstance.currentStep safely.
        const remainingOldOrders = desired
          .filter((d) => d.kind === "existing")
          .map((d) => (d.kind === "existing" ? d.oldStepOrder : null))
          .filter((v): v is number => typeof v === "number");
        const orderMap = new Map<number, number>();
        for (let i = 0; i < desired.length; i++) {
          const d = desired[i]!;
          if (d.kind === "existing") {
            orderMap.set(d.oldStepOrder!, i + 1);
          }
        }

        if (hasEmailSteps) {
          await tx.followUpStep.deleteMany({
            where: { sequenceId: sequence.id, channel: "email" },
          });
        }

        // Stage existing steps to non-conflicting stepOrder values
        const existingInDesired = desired.filter((d) => d.kind === "existing") as Array<
          Extract<(typeof desired)[number], { kind: "existing" }>
        >;
        for (let i = 0; i < existingInDesired.length; i++) {
          await tx.followUpStep.update({
            where: { id: existingInDesired[i]!.id },
            data: { stepOrder: 1000 + i },
          });
        }

        // Create new steps (if any) with non-conflicting stepOrder values
        const createdIds: string[] = [];
        for (let i = 0; i < desired.length; i++) {
          const d = desired[i]!;
          if (d.kind !== "new") continue;
          const created = await tx.followUpStep.create({
            data: {
              sequenceId: sequence.id,
              stepOrder: 2000 + i,
              dayOffset: d.dayOffset,
              channel: d.channel,
              messageTemplate: d.messageTemplate,
              subject: d.subject,
              condition: d.condition ? JSON.stringify(d.condition) : null,
              requiresApproval: d.requiresApproval,
              fallbackStepId: d.fallbackStepId,
            },
            select: { id: true },
          });
          createdIds.push(created.id);
        }

        // Final renumber pass (two-phase to satisfy @@unique([sequenceId, stepOrder]))
        const resolvedIds: string[] = [];
        let createdIdx = 0;
        for (const d of desired) {
          if (d.kind === "existing") {
            resolvedIds.push(d.id);
          } else {
            resolvedIds.push(createdIds[createdIdx++]!);
          }
        }

        for (let i = 0; i < resolvedIds.length; i++) {
          await tx.followUpStep.update({
            where: { id: resolvedIds[i]! },
            data: { stepOrder: 3000 + i },
          });
        }
        for (let i = 0; i < resolvedIds.length; i++) {
          await tx.followUpStep.update({
            where: { id: resolvedIds[i]! },
            data: { stepOrder: i + 1 },
          });
        }

        // Map in-flight instances to the new stepOrder numbering.
        // If the last completed step was an email step, fall back to the nearest prior non-email step.
        const instances = await tx.followUpInstance.findMany({
          where: { sequenceId: sequence.id },
          select: { id: true, currentStep: true },
        });

        for (const instance of instances) {
          if (!instance.currentStep || instance.currentStep <= 0) continue;
          const lastOld = remainingOldOrders.filter((o) => o <= instance.currentStep).pop() ?? 0;
          const newCurrent = lastOld ? orderMap.get(lastOld) ?? 0 : 0;
          if (newCurrent !== instance.currentStep) {
            await tx.followUpInstance.update({
              where: { id: instance.id },
              data: { currentStep: newCurrent },
            });
          }
        }
      });

      updated++;
    }

    // Post-booking default is email-only; disable it in Airtable Mode so it can't auto-start.
    await prisma.followUpSequence.updateMany({
      where: {
        clientId: opts.clientId,
        name: DEFAULT_SEQUENCE_NAMES.postBooking,
      },
      data: { isActive: false },
    });

    revalidatePath("/");
    return { success: true, updated };
  } catch (error) {
    console.error("Failed to apply Airtable Mode to default sequences:", error);
    return { success: false, error: "Failed to apply Airtable Mode" };
  }
}
