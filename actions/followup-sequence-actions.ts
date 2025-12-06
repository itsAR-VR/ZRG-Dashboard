"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

// =============================================================================
// Types
// =============================================================================

export interface FollowUpStepData {
  id?: string;
  stepOrder: number;
  dayOffset: number;
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
  triggerOn: "no_response" | "meeting_selected" | "manual";
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
      steps: seq.steps.map((step) => ({
        id: step.id,
        stepOrder: step.stepOrder,
        dayOffset: step.dayOffset,
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

    const formattedSequence: FollowUpSequenceData = {
      id: sequence.id,
      name: sequence.name,
      description: sequence.description,
      clientId: sequence.clientId,
      isActive: sequence.isActive,
      triggerOn: sequence.triggerOn as FollowUpSequenceData["triggerOn"],
      steps: sequence.steps.map((step) => ({
        id: step.id,
        stepOrder: step.stepOrder,
        dayOffset: step.dayOffset,
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
  triggerOn?: "no_response" | "meeting_selected" | "manual";
  steps: Omit<FollowUpStepData, "id">[];
}): Promise<{ success: boolean; sequenceId?: string; error?: string }> {
  try {
    const sequence = await prisma.followUpSequence.create({
      data: {
        clientId: data.clientId,
        name: data.name,
        description: data.description,
        triggerOn: data.triggerOn || "no_response",
        isActive: true,
        steps: {
          create: data.steps.map((step) => ({
            stepOrder: step.stepOrder,
            dayOffset: step.dayOffset,
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
    triggerOn?: "no_response" | "meeting_selected" | "manual";
    steps?: Omit<FollowUpStepData, "id">[];
  }
): Promise<{ success: boolean; error?: string }> {
  try {
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
        ...(data.steps && {
          steps: {
            create: data.steps.map((step) => ({
              stepOrder: step.stepOrder,
              dayOffset: step.dayOffset,
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
      select: { isActive: true },
    });

    if (!sequence) {
      return { success: false, error: "Sequence not found" };
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

    // Calculate first step due date
    const firstStep = sequence.steps[0];
    const nextStepDue = firstStep
      ? new Date(Date.now() + firstStep.dayOffset * 24 * 60 * 60 * 1000)
      : null;

    // Create or update instance
    const instance = await prisma.followUpInstance.upsert({
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
    });

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

    // Calculate next step due date
    const nextStep = instance.sequence.steps.find(
      (s) => s.stepOrder > instance.currentStep
    );
    const nextStepDue = nextStep
      ? new Date(Date.now() + nextStep.dayOffset * 24 * 60 * 60 * 1000)
      : null;

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

    // Calculate next step due date based on day offset difference
    const dayDiff = nextStep.dayOffset - (currentStep?.dayOffset || 0);
    const nextStepDue = new Date(Date.now() + dayDiff * 24 * 60 * 60 * 1000);

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

/**
 * Create the default Day 2/5/7 follow-up sequence for a workspace
 */
export async function createDefaultSequence(
  clientId: string
): Promise<{ success: boolean; sequenceId?: string; error?: string }> {
  const defaultSteps: Omit<FollowUpStepData, "id">[] = [
    {
      stepOrder: 1,
      dayOffset: 2,
      channel: "email",
      messageTemplate: "Hi {firstName},\n\nJust following up on my previous message. Would love to connect and learn more about your needs.\n\nDo you have 15 minutes this week for a quick call?",
      subject: "Following up - quick question",
      condition: { type: "always" },
      requiresApproval: false,
      fallbackStepId: null,
    },
    {
      stepOrder: 2,
      dayOffset: 2,
      channel: "sms",
      messageTemplate: "Hi {firstName}, sent you an email - let me know if you'd like to chat!",
      subject: null,
      condition: { type: "phone_provided" },
      requiresApproval: false,
      fallbackStepId: null,
    },
    {
      stepOrder: 3,
      dayOffset: 5,
      channel: "email",
      messageTemplate: "Hi {firstName},\n\nI wanted to share some availability in case you'd like to connect:\n\n{availability}\n\nLet me know what works for you!",
      subject: "Re: Following up - quick question",
      condition: { type: "always" },
      requiresApproval: false,
      fallbackStepId: null,
    },
    {
      stepOrder: 4,
      dayOffset: 5,
      channel: "sms",
      messageTemplate: "Hi {firstName}, shared some times that work for a call. Check your email when you have a chance!",
      subject: null,
      condition: { type: "phone_provided" },
      requiresApproval: false,
      fallbackStepId: null,
    },
    {
      stepOrder: 5,
      dayOffset: 7,
      channel: "email",
      messageTemplate: "Hi {firstName},\n\nI don't want to be a pest, so this will be my last follow-up. If you're ever interested in connecting, feel free to reach out.\n\nBest of luck!",
      subject: "Re: Following up - quick question",
      condition: { type: "always" },
      requiresApproval: false,
      fallbackStepId: null,
    },
    {
      stepOrder: 6,
      dayOffset: 7,
      channel: "sms",
      messageTemplate: "Hi {firstName}, just sent my final follow-up. No pressure - reach out anytime if interested!",
      subject: null,
      condition: { type: "phone_provided" },
      requiresApproval: false,
      fallbackStepId: null,
    },
  ];

  return createFollowUpSequence({
    clientId,
    name: "Default Day 2/5/7 Sequence",
    description: "Standard follow-up sequence: Day 2 (email + SMS), Day 5 (availability + SMS), Day 7 (final + SMS)",
    triggerOn: "no_response",
    steps: defaultSteps,
  });
}
