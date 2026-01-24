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
            ...(stage.instructionOrder !== undefined && { instructionOrder: stage.instructionOrder }),
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
    if (data.name !== undefined && data.name !== existing.name) {
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
      const updatedProcess = await tx.bookingProcess.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.maxWavesBeforeEscalation !== undefined && {
            maxWavesBeforeEscalation: data.maxWavesBeforeEscalation,
          }),
        },
      });

      if (data.stages) {
        const existingStages = await tx.bookingProcessStage.findMany({
          where: { bookingProcessId: id },
          select: { id: true, stageNumber: true },
          orderBy: { stageNumber: "asc" },
        });

        const existingStageIds = new Set(existingStages.map((s) => s.id));
        const requestStageIds = data.stages
          .map((s) => s.id)
          .filter((stageId): stageId is string => Boolean(stageId));

        const hasAnyStageIds = requestStageIds.length > 0;

        const stageDataFromInput = (stage: BookingProcessStageInput) => ({
          includeBookingLink: stage.includeBookingLink,
          linkType: stage.linkType,
          includeSuggestedTimes: stage.includeSuggestedTimes,
          numberOfTimesToSuggest: stage.numberOfTimesToSuggest,
          includeQualifyingQuestions: stage.includeQualifyingQuestions,
          qualificationQuestionIds: stage.qualificationQuestionIds,
          includeTimezoneAsk: stage.includeTimezoneAsk,
          ...(stage.instructionOrder !== undefined && { instructionOrder: stage.instructionOrder }),
          applyToEmail: stage.applyToEmail,
          applyToSms: stage.applyToSms,
          applyToLinkedin: stage.applyToLinkedin,
        });

        if (hasAnyStageIds) {
          // Ensure all provided stage IDs belong to this booking process
          for (const stageId of requestStageIds) {
            if (!existingStageIds.has(stageId)) {
              throw new Error("Invalid stage id in update payload");
            }
          }

          // Delete any stages removed from the payload
          await tx.bookingProcessStage.deleteMany({
            where: {
              bookingProcessId: id,
              id: { notIn: requestStageIds },
            },
          });

          // Avoid stageNumber uniqueness collisions during reorders by moving existing stages to a temp range first.
          for (const stage of data.stages) {
            if (!stage.id) continue;
            await tx.bookingProcessStage.update({
              where: { id: stage.id },
              data: { stageNumber: 10_000 + stage.stageNumber },
            });
          }

          // Apply updates + creates in final order; preserves instructionTemplates on existing stage rows.
          for (const stage of data.stages) {
            if (stage.id && existingStageIds.has(stage.id)) {
              await tx.bookingProcessStage.update({
                where: { id: stage.id },
                data: {
                  stageNumber: stage.stageNumber,
                  ...stageDataFromInput(stage),
                },
              });
            } else {
              await tx.bookingProcessStage.create({
                data: {
                  bookingProcessId: id,
                  stageNumber: stage.stageNumber,
                  ...stageDataFromInput(stage),
                },
              });
            }
          }
        } else {
          // Backwards compatibility path: no stage IDs. Preserve existing instructionTemplates by updating in place
          // based on stageNumber (best-effort; can't safely detect reorders without IDs).
          const existingByStageNumber = new Map(existingStages.map((s) => [s.stageNumber, s.id]));

          // Delete any trailing stages that no longer exist.
          await tx.bookingProcessStage.deleteMany({
            where: {
              bookingProcessId: id,
              stageNumber: { gt: data.stages.length },
            },
          });

          for (const stage of data.stages) {
            const existingId = existingByStageNumber.get(stage.stageNumber);
            if (existingId) {
              await tx.bookingProcessStage.update({
                where: { id: existingId },
                data: {
                  stageNumber: stage.stageNumber,
                  ...stageDataFromInput(stage),
                },
              });
            } else {
              await tx.bookingProcessStage.create({
                data: {
                  bookingProcessId: id,
                  stageNumber: stage.stageNumber,
                  ...stageDataFromInput(stage),
                },
              });
            }
          }
        }
      }

      return updatedProcess;
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
            instructionOrder: stage.instructionOrder ?? undefined,
            applyToEmail: stage.applyToEmail,
            applyToSms: stage.applyToSms,
            applyToLinkedin: stage.applyToLinkedin,
            instructionTemplates: stage.instructionTemplates ?? undefined,
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

export async function createBookingProcessesFromTemplates(
  clientId: string,
  templateNames: string[]
): Promise<{
  success: boolean;
  createdNames?: string[];
  skippedNames?: string[];
  error?: string;
}> {
  try {
    await requireClientAdminAccess(clientId);

    const requested = (templateNames || [])
      .map((t) => (typeof t === "string" ? t.trim() : ""))
      .filter(Boolean);
    if (requested.length === 0) return { success: false, error: "No templates selected" };

    const templatesByName = new Map(BOOKING_PROCESS_TEMPLATES.map((t) => [t.name, t]));
    const resolved = requested.map((name) => ({ name, template: templatesByName.get(name) || null }));

    const existing = await prisma.bookingProcess.findMany({
      where: { clientId },
      select: { name: true },
    });
    const existingNames = new Set(existing.map((p) => p.name));

    const createdNames: string[] = [];
    const skippedNames: string[] = [];

    for (const item of resolved) {
      const template = item.template;
      if (!template) {
        skippedNames.push(item.name);
        continue;
      }

      if (existingNames.has(template.name)) {
        skippedNames.push(template.name);
        continue;
      }

      const process = await prisma.bookingProcess.create({
        data: {
          clientId,
          name: template.name,
          description: template.description,
          maxWavesBeforeEscalation: 5,
          stages: {
            create: template.stages.map((stage) => ({
              stageNumber: stage.stageNumber,
              includeBookingLink: stage.includeBookingLink,
              linkType: stage.linkType,
              includeSuggestedTimes: stage.includeSuggestedTimes,
              numberOfTimesToSuggest: stage.numberOfTimesToSuggest,
              includeQualifyingQuestions: stage.includeQualifyingQuestions,
              qualificationQuestionIds: stage.qualificationQuestionIds,
              includeTimezoneAsk: stage.includeTimezoneAsk,
              instructionOrder: stage.instructionOrder ?? undefined,
              applyToEmail: stage.applyToEmail,
              applyToSms: stage.applyToSms,
              applyToLinkedin: stage.applyToLinkedin,
            })),
          },
        },
        select: { name: true },
      });

      createdNames.push(process.name);
      existingNames.add(process.name);
    }

    return { success: true, createdNames, skippedNames };
  } catch (error) {
    console.error("[createBookingProcessesFromTemplates] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create booking processes from templates",
    };
  }
}

// ----------------------------------------------------------------------------
// Update Stage Instruction Templates (Phase 47k)
// ----------------------------------------------------------------------------

import { Prisma } from "@prisma/client";
import type { BookingStageTemplates } from "@/lib/booking-stage-templates";

/**
 * Get a booking process stage by ID, including its instruction templates.
 */
export async function getBookingProcessStage(
  stageId: string
): Promise<{ success: boolean; data?: BookingProcessStage; error?: string }> {
  try {
    const stage = await prisma.bookingProcessStage.findUnique({
      where: { id: stageId },
      include: {
        bookingProcess: {
          select: { clientId: true },
        },
      },
    });

    if (!stage) {
      return { success: false, error: "Stage not found" };
    }

    await requireClientAccess(stage.bookingProcess.clientId);

    return { success: true, data: stage };
  } catch (error) {
    console.error("[getBookingProcessStage] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to get stage",
    };
  }
}

/**
 * Update instruction templates for a booking process stage.
 * Admin-gated to prevent unauthorized edits.
 */
export async function updateBookingStageTemplates(
  stageId: string,
  templates: BookingStageTemplates | null
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get stage to find clientId for auth check
    const stage = await prisma.bookingProcessStage.findUnique({
      where: { id: stageId },
      include: {
        bookingProcess: {
          select: { clientId: true },
        },
      },
    });

    if (!stage) {
      return { success: false, error: "Stage not found" };
    }

    // Admin-only
    await requireClientAdminAccess(stage.bookingProcess.clientId);

    // Update templates (set to Prisma.DbNull to reset to defaults)
    await prisma.bookingProcessStage.update({
      where: { id: stageId },
      data: {
        instructionTemplates: templates === null ? Prisma.DbNull : templates,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("[updateBookingStageTemplates] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update stage templates",
    };
  }
}

/**
 * Get all stages for a booking process with their templates.
 */
export async function getBookingProcessStagesWithTemplates(
  bookingProcessId: string
): Promise<{
  success: boolean;
  data?: Array<{
    id: string;
    stageNumber: number;
    instructionTemplates: BookingStageTemplates | null;
  }>;
  error?: string;
}> {
  try {
    const process = await prisma.bookingProcess.findUnique({
      where: { id: bookingProcessId },
      select: { clientId: true },
    });

    if (!process) {
      return { success: false, error: "Booking process not found" };
    }

    await requireClientAccess(process.clientId);

    const stages = await prisma.bookingProcessStage.findMany({
      where: { bookingProcessId },
      orderBy: { stageNumber: "asc" },
      select: {
        id: true,
        stageNumber: true,
        instructionTemplates: true,
      },
    });

    return {
      success: true,
      data: stages.map((s) => ({
        id: s.id,
        stageNumber: s.stageNumber,
        instructionTemplates: s.instructionTemplates as BookingStageTemplates | null,
      })),
    };
  } catch (error) {
    console.error("[getBookingProcessStagesWithTemplates] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to get stages",
    };
  }
}
