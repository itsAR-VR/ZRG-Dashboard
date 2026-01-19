"use server";

/**
 * AI Persona CRUD Actions (Phase 39)
 *
 * Server actions for managing AI personas.
 * AI personas define how the AI communicates: name, tone, greeting, signature, goals, etc.
 */

import { prisma } from "@/lib/prisma";
import { requireClientAccess, requireClientAdminAccess, requireAuthUser } from "@/lib/workspace-access";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type AiPersonaData = {
  id: string;
  name: string;
  isDefault: boolean;
  personaName: string | null;
  tone: string;
  greeting: string | null;
  smsGreeting: string | null;
  signature: string | null;
  goals: string | null;
  serviceDescription: string | null;
  idealCustomerProfile: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AiPersonaSummary = {
  id: string;
  name: string;
  isDefault: boolean;
  personaName: string | null;
  tone: string;
  campaignCount: number;
};

export type CreateAiPersonaInput = {
  name: string;
  personaName?: string | null;
  tone?: string;
  greeting?: string | null;
  smsGreeting?: string | null;
  signature?: string | null;
  goals?: string | null;
  serviceDescription?: string | null;
  idealCustomerProfile?: string | null;
  isDefault?: boolean;
};

export type UpdateAiPersonaInput = Partial<CreateAiPersonaInput>;

// ----------------------------------------------------------------------------
// List AI Personas
// ----------------------------------------------------------------------------

export async function listAiPersonas(
  clientId: string
): Promise<{ success: boolean; data?: AiPersonaSummary[]; error?: string }> {
  try {
    await requireClientAccess(clientId);

    const personas = await prisma.aiPersona.findMany({
      where: { clientId },
      include: {
        _count: {
          select: { campaigns: true },
        },
      },
      orderBy: [
        { isDefault: "desc" }, // Default first
        { name: "asc" },
      ],
    });

    const summaries: AiPersonaSummary[] = personas.map((p) => ({
      id: p.id,
      name: p.name,
      isDefault: p.isDefault,
      personaName: p.personaName,
      tone: p.tone,
      campaignCount: p._count.campaigns,
    }));

    return { success: true, data: summaries };
  } catch (error) {
    console.error("[listAiPersonas] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to list AI personas",
    };
  }
}

// ----------------------------------------------------------------------------
// Get Single AI Persona
// ----------------------------------------------------------------------------

export async function getAiPersona(
  id: string
): Promise<{ success: boolean; data?: AiPersonaData; error?: string }> {
  try {
    const persona = await prisma.aiPersona.findUnique({
      where: { id },
    });

    if (!persona) {
      return { success: false, error: "AI persona not found" };
    }

    await requireClientAccess(persona.clientId);

    return {
      success: true,
      data: {
        id: persona.id,
        name: persona.name,
        isDefault: persona.isDefault,
        personaName: persona.personaName,
        tone: persona.tone,
        greeting: persona.greeting,
        smsGreeting: persona.smsGreeting,
        signature: persona.signature,
        goals: persona.goals,
        serviceDescription: persona.serviceDescription,
        idealCustomerProfile: persona.idealCustomerProfile,
        createdAt: persona.createdAt,
        updatedAt: persona.updatedAt,
      },
    };
  } catch (error) {
    console.error("[getAiPersona] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to get AI persona",
    };
  }
}

// ----------------------------------------------------------------------------
// Create AI Persona
// ----------------------------------------------------------------------------

export async function createAiPersona(
  clientId: string,
  input: CreateAiPersonaInput
): Promise<{ success: boolean; data?: AiPersonaData; error?: string }> {
  try {
    const { userId } = await requireClientAdminAccess(clientId);

    // Validate name is provided
    if (!input.name?.trim()) {
      return { success: false, error: "Persona name is required" };
    }

    const trimmedName = input.name.trim();

    // Validate name uniqueness
    const existing = await prisma.aiPersona.findFirst({
      where: {
        clientId,
        name: trimmedName,
      },
    });

    if (existing) {
      return { success: false, error: "A persona with this name already exists" };
    }

    // Create persona in transaction (handle isDefault logic)
    const persona = await prisma.$transaction(async (tx) => {
      // If this is the first persona or isDefault is true, unset existing defaults
      if (input.isDefault) {
        await tx.aiPersona.updateMany({
          where: { clientId, isDefault: true },
          data: { isDefault: false },
        });
      }

      // Check if this is the first persona (auto-set as default)
      const personaCount = await tx.aiPersona.count({ where: { clientId } });
      const shouldBeDefault = input.isDefault || personaCount === 0;

      return tx.aiPersona.create({
        data: {
          clientId,
          name: trimmedName,
          isDefault: shouldBeDefault,
          personaName: input.personaName?.trim() || null,
          tone: input.tone || "friendly-professional",
          greeting: input.greeting?.trim() || null,
          smsGreeting: input.smsGreeting?.trim() || null,
          signature: input.signature?.trim() || null,
          goals: input.goals?.trim() || null,
          serviceDescription: input.serviceDescription?.trim() || null,
          idealCustomerProfile: input.idealCustomerProfile?.trim() || null,
          createdBy: userId,
        },
      });
    });

    return {
      success: true,
      data: {
        id: persona.id,
        name: persona.name,
        isDefault: persona.isDefault,
        personaName: persona.personaName,
        tone: persona.tone,
        greeting: persona.greeting,
        smsGreeting: persona.smsGreeting,
        signature: persona.signature,
        goals: persona.goals,
        serviceDescription: persona.serviceDescription,
        idealCustomerProfile: persona.idealCustomerProfile,
        createdAt: persona.createdAt,
        updatedAt: persona.updatedAt,
      },
    };
  } catch (error) {
    console.error("[createAiPersona] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create AI persona",
    };
  }
}

// ----------------------------------------------------------------------------
// Update AI Persona
// ----------------------------------------------------------------------------

export async function updateAiPersona(
  id: string,
  input: UpdateAiPersonaInput
): Promise<{ success: boolean; data?: AiPersonaData; error?: string }> {
  try {
    const existing = await prisma.aiPersona.findUnique({
      where: { id },
      select: { clientId: true, name: true, isDefault: true },
    });

    if (!existing) {
      return { success: false, error: "AI persona not found" };
    }

    await requireClientAdminAccess(existing.clientId);

    // Validate name uniqueness if changing
    if (input.name !== undefined && input.name.trim() !== existing.name) {
      const duplicate = await prisma.aiPersona.findFirst({
        where: {
          clientId: existing.clientId,
          name: input.name.trim(),
          NOT: { id },
        },
      });

      if (duplicate) {
        return { success: false, error: "A persona with this name already exists" };
      }
    }

    // Update persona in transaction (handle isDefault logic + sync to WorkspaceSettings)
    const persona = await prisma.$transaction(async (tx) => {
      // If setting as default and not already default, unset other defaults
      if (input.isDefault === true && !existing.isDefault) {
        await tx.aiPersona.updateMany({
          where: { clientId: existing.clientId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const updated = await tx.aiPersona.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name.trim() }),
          ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
          ...(input.personaName !== undefined && { personaName: input.personaName?.trim() || null }),
          ...(input.tone !== undefined && { tone: input.tone }),
          ...(input.greeting !== undefined && { greeting: input.greeting?.trim() || null }),
          ...(input.smsGreeting !== undefined && { smsGreeting: input.smsGreeting?.trim() || null }),
          ...(input.signature !== undefined && { signature: input.signature?.trim() || null }),
          ...(input.goals !== undefined && { goals: input.goals?.trim() || null }),
          ...(input.serviceDescription !== undefined && {
            serviceDescription: input.serviceDescription?.trim() || null,
          }),
          ...(input.idealCustomerProfile !== undefined && {
            idealCustomerProfile: input.idealCustomerProfile?.trim() || null,
          }),
        },
      });

      // Sync default persona fields to WorkspaceSettings (Phase 39g locked decision)
      // This keeps legacy WorkspaceSettings.ai* fields in sync with the default persona
      const isNowDefault = updated.isDefault || (existing.isDefault && input.isDefault !== false);
      if (isNowDefault) {
        await tx.workspaceSettings.upsert({
          where: { clientId: existing.clientId },
          create: {
            clientId: existing.clientId,
            aiPersonaName: updated.personaName,
            aiTone: updated.tone,
            aiGreeting: updated.greeting,
            aiSmsGreeting: updated.smsGreeting,
            aiSignature: updated.signature,
            aiGoals: updated.goals,
            serviceDescription: updated.serviceDescription,
          },
          update: {
            aiPersonaName: updated.personaName,
            aiTone: updated.tone,
            aiGreeting: updated.greeting,
            aiSmsGreeting: updated.smsGreeting,
            aiSignature: updated.signature,
            aiGoals: updated.goals,
            serviceDescription: updated.serviceDescription,
          },
        });
      }

      return updated;
    });

    return {
      success: true,
      data: {
        id: persona.id,
        name: persona.name,
        isDefault: persona.isDefault,
        personaName: persona.personaName,
        tone: persona.tone,
        greeting: persona.greeting,
        smsGreeting: persona.smsGreeting,
        signature: persona.signature,
        goals: persona.goals,
        serviceDescription: persona.serviceDescription,
        idealCustomerProfile: persona.idealCustomerProfile,
        createdAt: persona.createdAt,
        updatedAt: persona.updatedAt,
      },
    };
  } catch (error) {
    console.error("[updateAiPersona] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update AI persona",
    };
  }
}

// ----------------------------------------------------------------------------
// Delete AI Persona
// ----------------------------------------------------------------------------

export async function deleteAiPersona(
  id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const existing = await prisma.aiPersona.findUnique({
      where: { id },
      include: {
        _count: { select: { campaigns: true } },
      },
    });

    if (!existing) {
      return { success: false, error: "AI persona not found" };
    }

    await requireClientAdminAccess(existing.clientId);

    // Delete persona in transaction
    await prisma.$transaction(async (tx) => {
      // Delete the persona (campaigns will have aiPersonaId set to null via onDelete: SetNull)
      await tx.aiPersona.delete({ where: { id } });

      // If deleted persona was default, promote another persona
      if (existing.isDefault) {
        const nextDefault = await tx.aiPersona.findFirst({
          where: { clientId: existing.clientId },
          orderBy: { createdAt: "asc" },
        });

        if (nextDefault) {
          await tx.aiPersona.update({
            where: { id: nextDefault.id },
            data: { isDefault: true },
          });
        }
      }
    });

    return { success: true };
  } catch (error) {
    console.error("[deleteAiPersona] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete AI persona",
    };
  }
}

// ----------------------------------------------------------------------------
// Set Default AI Persona
// ----------------------------------------------------------------------------

export async function setDefaultAiPersona(
  id: string
): Promise<{ success: boolean; data?: AiPersonaData; error?: string }> {
  try {
    const existing = await prisma.aiPersona.findUnique({
      where: { id },
    });

    if (!existing) {
      return { success: false, error: "AI persona not found" };
    }

    await requireClientAdminAccess(existing.clientId);

    if (existing.isDefault) {
      // Already default, return as-is
      return {
        success: true,
        data: {
          id: existing.id,
          name: existing.name,
          isDefault: existing.isDefault,
          personaName: existing.personaName,
          tone: existing.tone,
          greeting: existing.greeting,
          smsGreeting: existing.smsGreeting,
          signature: existing.signature,
          goals: existing.goals,
          serviceDescription: existing.serviceDescription,
          idealCustomerProfile: existing.idealCustomerProfile,
          createdAt: existing.createdAt,
          updatedAt: existing.updatedAt,
        },
      };
    }

    // Set as default in transaction and sync to WorkspaceSettings
    const persona = await prisma.$transaction(async (tx) => {
      // Unset existing default
      await tx.aiPersona.updateMany({
        where: { clientId: existing.clientId, isDefault: true },
        data: { isDefault: false },
      });

      // Set this one as default
      const updated = await tx.aiPersona.update({
        where: { id },
        data: { isDefault: true },
      });

      // Sync new default persona fields to WorkspaceSettings (Phase 39g locked decision)
      await tx.workspaceSettings.upsert({
        where: { clientId: existing.clientId },
        create: {
          clientId: existing.clientId,
          aiPersonaName: updated.personaName,
          aiTone: updated.tone,
          aiGreeting: updated.greeting,
          aiSmsGreeting: updated.smsGreeting,
          aiSignature: updated.signature,
          aiGoals: updated.goals,
          serviceDescription: updated.serviceDescription,
        },
        update: {
          aiPersonaName: updated.personaName,
          aiTone: updated.tone,
          aiGreeting: updated.greeting,
          aiSmsGreeting: updated.smsGreeting,
          aiSignature: updated.signature,
          aiGoals: updated.goals,
          serviceDescription: updated.serviceDescription,
        },
      });

      return updated;
    });

    return {
      success: true,
      data: {
        id: persona.id,
        name: persona.name,
        isDefault: persona.isDefault,
        personaName: persona.personaName,
        tone: persona.tone,
        greeting: persona.greeting,
        smsGreeting: persona.smsGreeting,
        signature: persona.signature,
        goals: persona.goals,
        serviceDescription: persona.serviceDescription,
        idealCustomerProfile: persona.idealCustomerProfile,
        createdAt: persona.createdAt,
        updatedAt: persona.updatedAt,
      },
    };
  } catch (error) {
    console.error("[setDefaultAiPersona] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to set default AI persona",
    };
  }
}

// ----------------------------------------------------------------------------
// Get Default AI Persona
// ----------------------------------------------------------------------------

export async function getDefaultAiPersona(
  clientId: string
): Promise<{ success: boolean; data?: AiPersonaData | null; error?: string }> {
  try {
    await requireClientAccess(clientId);

    const persona = await prisma.aiPersona.findFirst({
      where: { clientId, isDefault: true },
    });

    if (!persona) {
      return { success: true, data: null };
    }

    return {
      success: true,
      data: {
        id: persona.id,
        name: persona.name,
        isDefault: persona.isDefault,
        personaName: persona.personaName,
        tone: persona.tone,
        greeting: persona.greeting,
        smsGreeting: persona.smsGreeting,
        signature: persona.signature,
        goals: persona.goals,
        serviceDescription: persona.serviceDescription,
        idealCustomerProfile: persona.idealCustomerProfile,
        createdAt: persona.createdAt,
        updatedAt: persona.updatedAt,
      },
    };
  } catch (error) {
    console.error("[getDefaultAiPersona] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to get default AI persona",
    };
  }
}

// ----------------------------------------------------------------------------
// Get or Create Default Persona from WorkspaceSettings (Backward Compatibility)
// ----------------------------------------------------------------------------

/**
 * For workspaces with no personas, creates a "Default" persona from existing
 * WorkspaceSettings fields. This enables backward compatibility.
 * Admin-gated: only workspace admins can trigger persona creation.
 * Idempotent: safe to call multiple times concurrently.
 */
export async function getOrCreateDefaultPersonaFromSettings(
  clientId: string
): Promise<{ success: boolean; data?: AiPersonaData; error?: string }> {
  try {
    // Admin-gated: writes require admin access
    const { userId } = await requireClientAdminAccess(clientId);

    // Use a transaction to ensure exactly one default is created under concurrency
    const result = await prisma.$transaction(async (tx) => {
      // Check if any personas already exist
      const existingCount = await tx.aiPersona.count({ where: { clientId } });

      if (existingCount > 0) {
        // Personas exist, return the default one
        const defaultPersona = await tx.aiPersona.findFirst({
          where: { clientId, isDefault: true },
        });

        if (defaultPersona) {
          return defaultPersona;
        }

        // No default set, set the first one as default
        const first = await tx.aiPersona.findFirst({
          where: { clientId },
          orderBy: { createdAt: "asc" },
        });

        if (first) {
          return await tx.aiPersona.update({
            where: { id: first.id },
            data: { isDefault: true },
          });
        }
      }

      // No personas exist, create one from WorkspaceSettings
      const settings = await tx.workspaceSettings.findUnique({
        where: { clientId },
      });

      const client = await tx.client.findUnique({
        where: { id: clientId },
        select: { name: true },
      });

      return await tx.aiPersona.create({
        data: {
          clientId,
          name: "Default",
          isDefault: true,
          personaName: settings?.aiPersonaName || client?.name || null,
          tone: settings?.aiTone || "friendly-professional",
          greeting: settings?.aiGreeting || null,
          smsGreeting: settings?.aiSmsGreeting || null,
          signature: settings?.aiSignature || null,
          goals: settings?.aiGoals || null,
          serviceDescription: settings?.serviceDescription || null,
          idealCustomerProfile: settings?.idealCustomerProfile || null,
          createdBy: userId,
        },
      });
    });

    return {
      success: true,
      data: {
        id: result.id,
        name: result.name,
        isDefault: result.isDefault,
        personaName: result.personaName,
        tone: result.tone,
        greeting: result.greeting,
        smsGreeting: result.smsGreeting,
        signature: result.signature,
        goals: result.goals,
        serviceDescription: result.serviceDescription,
        idealCustomerProfile: result.idealCustomerProfile,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      },
    };
  } catch (error) {
    console.error("[getOrCreateDefaultPersonaFromSettings] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to get or create default persona",
    };
  }
}

// ----------------------------------------------------------------------------
// Duplicate AI Persona
// ----------------------------------------------------------------------------

export async function duplicateAiPersona(
  id: string,
  newName?: string
): Promise<{ success: boolean; data?: AiPersonaData; error?: string }> {
  try {
    const existing = await prisma.aiPersona.findUnique({
      where: { id },
    });

    if (!existing) {
      return { success: false, error: "AI persona not found" };
    }

    const { userId } = await requireClientAdminAccess(existing.clientId);

    // Generate unique name
    const baseName = newName?.trim() || `${existing.name} (Copy)`;
    let finalName = baseName;
    let counter = 1;

    while (true) {
      const duplicate = await prisma.aiPersona.findFirst({
        where: {
          clientId: existing.clientId,
          name: finalName,
        },
      });

      if (!duplicate) break;

      counter++;
      finalName = `${baseName} ${counter}`;
    }

    // Create duplicate (never as default)
    const persona = await prisma.aiPersona.create({
      data: {
        clientId: existing.clientId,
        name: finalName,
        isDefault: false,
        personaName: existing.personaName,
        tone: existing.tone,
        greeting: existing.greeting,
        smsGreeting: existing.smsGreeting,
        signature: existing.signature,
        goals: existing.goals,
        serviceDescription: existing.serviceDescription,
        idealCustomerProfile: existing.idealCustomerProfile,
        createdBy: userId,
      },
    });

    return {
      success: true,
      data: {
        id: persona.id,
        name: persona.name,
        isDefault: persona.isDefault,
        personaName: persona.personaName,
        tone: persona.tone,
        greeting: persona.greeting,
        smsGreeting: persona.smsGreeting,
        signature: persona.signature,
        goals: persona.goals,
        serviceDescription: persona.serviceDescription,
        idealCustomerProfile: persona.idealCustomerProfile,
        createdAt: persona.createdAt,
        updatedAt: persona.updatedAt,
      },
    };
  } catch (error) {
    console.error("[duplicateAiPersona] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to duplicate AI persona",
    };
  }
}
