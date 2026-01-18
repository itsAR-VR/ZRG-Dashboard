"use server";

/**
 * Booking Process CRUD Actions (Phase 36)
 *
 * Server actions for managing booking processes and their stages.
 * Booking processes define when/how the AI offers booking links, times, and qualifying questions.
 */

import { prisma } from "@/lib/prisma";
import { requireClientAccess, requireClientAdminAccess } from "@/lib/workspace-access";
import type {
  BookingProcess,
  BookingProcessStage,
  BookingProcessLinkType,
} from "@prisma/client";

import {
  BOOKING_PROCESS_TEMPLATES,
  type BookingProcessStageInput,
  type TemplateBookingProcess,
} from "@/lib/booking-process-templates";

// Re-export types for consumers
export type { BookingProcessStageInput, TemplateBookingProcess };

export type BookingProcessWithStages = BookingProcess & {
  stages: BookingProcessStage[];
  _count?: {
    campaigns: number;
  };
};

export type BookingProcessSummary = {
  id: string;
  name: string;
  description: string | null;
  stageCount: number;
  campaignCount: number;
  createdAt: Date;
  updatedAt: Date;
};

// ----------------------------------------------------------------------------
// List Booking Processes
// ----------------------------------------------------------------------------

export async function listBookingProcesses(
  clientId: string
): Promise<{ success: boolean; data?: BookingProcessSummary[]; error?: string }> {
  try {
    await requireClientAccess(clientId);

    const processes = await prisma.bookingProcess.findMany({
      where: { clientId },
      include: {
        _count: {
          select: {
            stages: true,
            campaigns: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    const summaries: BookingProcessSummary[] = processes.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      stageCount: p._count.stages,
      campaignCount: p._count.campaigns,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));

    return { success: true, data: summaries };
  } catch (error) {
    console.error("[listBookingProcesses] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to list booking processes",
    };
  }
}

// ----------------------------------------------------------------------------
// Get Single Booking Process with Stages
// ----------------------------------------------------------------------------

export async function getBookingProcess(
  id: string
): Promise<{ success: boolean; data?: BookingProcessWithStages; error?: string }> {
  try {
    const process = await prisma.bookingProcess.findUnique({
      where: { id },
      include: {
        stages: {
          orderBy: { stageNumber: "asc" },
        },
        _count: {
          select: { campaigns: true },
        },
      },
    });

    if (!process) {
      return { success: false, error: "Booking process not found" };
    }

    await requireClientAccess(process.clientId);

    return { success: true, data: process };
  } catch (error) {
    console.error("[getBookingProcess] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to get booking process",
    };
  }
}

// ----------------------------------------------------------------------------
// Create Booking Process
// ----------------------------------------------------------------------------

export async function createBookingProcess(data: {
  clientId: string;
  name: string;
  description?: string;
  maxWavesBeforeEscalation?: number;
  stages: BookingProcessStageInput[];
}): Promise<{ success: boolean; data?: BookingProcess; error?: string }> {
  try {
    await requireClientAdminAccess(data.clientId);

    // Validate name uniqueness
    const existing = await prisma.bookingProcess.findFirst({
      where: {
        clientId: data.clientId,
        name: data.name,
      },
    });

    if (existing) {
      return { success: false, error: "A booking process with this name already exists" };
    }

    // Validate stages
    if (!data.stages || data.stages.length === 0) {
      return { success: false, error: "At least one stage is required" };
    }

    // Validate stage numbers are sequential
    const sortedStages = [...data.stages].sort((a, b) => a.stageNumber - b.stageNumber);
    for (let i = 0; i < sortedStages.length; i++) {
      if (sortedStages[i].stageNumber !== i + 1) {
        return { success: false, error: "Stage numbers must be sequential starting from 1" };
      }
    }

    // Validate each stage has at least one channel
    for (const stage of data.stages) {
      if (!stage.applyToEmail && !stage.applyToSms && !stage.applyToLinkedin) {
        return {
          success: false,
          error: `Stage ${stage.stageNumber} must have at least one channel enabled`,
        };
      }
    }

    // Create booking process with stages
    const process = await prisma.bookingProcess.create({
      data: {
        clientId: data.clientId,
        name: data.name,
        description: data.description,
        maxWavesBeforeEscalation: data.maxWavesBeforeEscalation ?? 5,
        stages: {
          create: data.stages.map((stage) => ({
            stageNumber: stage.stageNumber,
            includeBookingLink: stage.includeBookingLink,
            linkType: stage.linkType,
            includeSuggestedTimes: stage.includeSuggestedTimes,
            numberOfTimesToSuggest: stage.numberOfTimesToSuggest,
            includeQualifyingQuestions: stage.includeQualifyingQuestions,
            qualificationQuestionIds: stage.qualificationQuestionIds,
            includeTimezoneAsk: stage.includeTimezoneAsk,
            applyToEmail: stage.applyToEmail,
            applyToSms: stage.applyToSms,
            applyToLinkedin: stage.applyToLinkedin,
          })),
        },
      },
    });

    return { success: true, data: process };
  } catch (error) {
    console.error("[createBookingProcess] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create booking process",
    };
  }
}

// ----------------------------------------------------------------------------
// Update Booking Process
// ----------------------------------------------------------------------------

export async function updateBookingProcess(
  id: string,
  data: {
    name?: string;
    description?: string;
    maxWavesBeforeEscalation?: number;
    stages?: BookingProcessStageInput[];
  }
): Promise<{ success: boolean; data?: BookingProcess; error?: string }> {
  try {
    const existing = await prisma.bookingProcess.findUnique({
      where: { id },
      select: { clientId: true, name: true },
    });

    if (!existing) {
      return { success: false, error: "Booking process not found" };
    }

    await requireClientAdminAccess(existing.clientId);

    // Validate name uniqueness if changing
    if (data.name && data.name !== existing.name) {
      const duplicate = await prisma.bookingProcess.findFirst({
        where: {
          clientId: existing.clientId,
          name: data.name,
          NOT: { id },
        },
      });

      if (duplicate) {
        return { success: false, error: "A booking process with this name already exists" };
      }
    }

    // Validate stages if provided
    if (data.stages) {
      if (data.stages.length === 0) {
        return { success: false, error: "At least one stage is required" };
      }

      const sortedStages = [...data.stages].sort((a, b) => a.stageNumber - b.stageNumber);
      for (let i = 0; i < sortedStages.length; i++) {
        if (sortedStages[i].stageNumber !== i + 1) {
          return { success: false, error: "Stage numbers must be sequential starting from 1" };
        }
      }

      for (const stage of data.stages) {
        if (!stage.applyToEmail && !stage.applyToSms && !stage.applyToLinkedin) {
          return {
            success: false,
            error: `Stage ${stage.stageNumber} must have at least one channel enabled`,
          };
        }
      }
    }

    // Update in transaction
    const process = await prisma.$transaction(async (tx) => {
      // Delete existing stages if new stages provided
      if (data.stages) {
        await tx.bookingProcessStage.deleteMany({
          where: { bookingProcessId: id },
        });
      }

      // Update booking process
      return tx.bookingProcess.update({
        where: { id },
        data: {
          ...(data.name && { name: data.name }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.maxWavesBeforeEscalation !== undefined && {
            maxWavesBeforeEscalation: data.maxWavesBeforeEscalation,
          }),
          ...(data.stages && {
            stages: {
              create: data.stages.map((stage) => ({
                stageNumber: stage.stageNumber,
                includeBookingLink: stage.includeBookingLink,
                linkType: stage.linkType,
                includeSuggestedTimes: stage.includeSuggestedTimes,
                numberOfTimesToSuggest: stage.numberOfTimesToSuggest,
                includeQualifyingQuestions: stage.includeQualifyingQuestions,
                qualificationQuestionIds: stage.qualificationQuestionIds,
                includeTimezoneAsk: stage.includeTimezoneAsk,
                applyToEmail: stage.applyToEmail,
                applyToSms: stage.applyToSms,
                applyToLinkedin: stage.applyToLinkedin,
              })),
            },
          }),
        },
      });
    });

    return { success: true, data: process };
  } catch (error) {
    console.error("[updateBookingProcess] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update booking process",
    };
  }
}

// ----------------------------------------------------------------------------
// Delete Booking Process
// ----------------------------------------------------------------------------

export async function deleteBookingProcess(
  id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const existing = await prisma.bookingProcess.findUnique({
      where: { id },
      include: {
        _count: { select: { campaigns: true } },
      },
    });

    if (!existing) {
      return { success: false, error: "Booking process not found" };
    }

    await requireClientAdminAccess(existing.clientId);

    // Check for active campaign assignments
    if (existing._count.campaigns > 0) {
      return {
        success: false,
        error: `Cannot delete: ${existing._count.campaigns} campaign(s) are using this booking process. Unassign them first.`,
      };
    }

    await prisma.bookingProcess.delete({
      where: { id },
    });

    return { success: true };
  } catch (error) {
    console.error("[deleteBookingProcess] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete booking process",
    };
  }
}

// ----------------------------------------------------------------------------
// Duplicate Booking Process
// ----------------------------------------------------------------------------

export async function duplicateBookingProcess(
  id: string,
  newName?: string
): Promise<{ success: boolean; data?: BookingProcess; error?: string }> {
  try {
    const existing = await prisma.bookingProcess.findUnique({
      where: { id },
      include: {
        stages: { orderBy: { stageNumber: "asc" } },
      },
    });

    if (!existing) {
      return { success: false, error: "Booking process not found" };
    }

    await requireClientAdminAccess(existing.clientId);

    // Generate unique name
    const baseName = newName || `${existing.name} (Copy)`;
    let finalName = baseName;
    let counter = 1;

    while (true) {
      const duplicate = await prisma.bookingProcess.findFirst({
        where: {
          clientId: existing.clientId,
          name: finalName,
        },
      });

      if (!duplicate) break;

      counter++;
      finalName = `${baseName} ${counter}`;
    }

    // Create duplicate
    const process = await prisma.bookingProcess.create({
      data: {
        clientId: existing.clientId,
        name: finalName,
        description: existing.description,
        maxWavesBeforeEscalation: existing.maxWavesBeforeEscalation,
        stages: {
          create: existing.stages.map((stage) => ({
            stageNumber: stage.stageNumber,
            includeBookingLink: stage.includeBookingLink,
            linkType: stage.linkType,
            includeSuggestedTimes: stage.includeSuggestedTimes,
            numberOfTimesToSuggest: stage.numberOfTimesToSuggest,
            includeQualifyingQuestions: stage.includeQualifyingQuestions,
            qualificationQuestionIds: stage.qualificationQuestionIds,
            includeTimezoneAsk: stage.includeTimezoneAsk,
            applyToEmail: stage.applyToEmail,
            applyToSms: stage.applyToSms,
            applyToLinkedin: stage.applyToLinkedin,
          })),
        },
      },
    });

    return { success: true, data: process };
  } catch (error) {
    console.error("[duplicateBookingProcess] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to duplicate booking process",
    };
  }
}

// ----------------------------------------------------------------------------
// Create Booking Process from Template
// ----------------------------------------------------------------------------

export async function createBookingProcessFromTemplate(
  clientId: string,
  templateName: string
): Promise<{ success: boolean; data?: BookingProcess; error?: string }> {
  const template = BOOKING_PROCESS_TEMPLATES.find((t) => t.name === templateName);

  if (!template) {
    return { success: false, error: "Template not found" };
  }

  return createBookingProcess({
    clientId,
    name: template.name,
    description: template.description,
    stages: template.stages,
  });
}
