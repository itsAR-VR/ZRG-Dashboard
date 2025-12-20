"use server";

import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export interface ClientData {
  name: string;
  ghlLocationId: string;
  ghlPrivateKey: string;
  emailBisonApiKey?: string;
  emailBisonWorkspaceId?: string;
  unipileAccountId?: string;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.trim();
}

function normalizeEmailBisonWorkspaceId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.trim().replace(/^#\s*/, "");
}

function validateEmailBisonWorkspaceId(value: string | undefined): string | null {
  const normalized = normalizeEmailBisonWorkspaceId(value);
  if (normalized === undefined) return null;
  if (normalized === "") return null;
  if (!/^\d+$/.test(normalized)) return "EmailBison Workspace ID must be a numeric value";
  return null;
}

/**
 * Get the current user's ID from Supabase
 */
async function getCurrentUserId(): Promise<string | null> {
  try {
    const supabase = await createSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id || null;
  } catch (error) {
    console.error("Failed to get current user:", error);
    return null;
  }
}

/**
 * Fetch all GHL clients/workspaces owned by the current user
 */
export async function getClients() {
  try {
    const userId = await getCurrentUserId();

    if (!userId) {
      return { success: false, error: "Not authenticated" };
    }

    const clients = await prisma.client.findMany({
      where: { userId }, // Only fetch workspaces owned by this user
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        ghlLocationId: true,
        emailBisonApiKey: true,
        emailBisonWorkspaceId: true,
        unipileAccountId: true,
        createdAt: true,
        _count: {
          select: { leads: true },
        },
      },
    });
    return { success: true, data: clients };
  } catch (error) {
    console.error("Failed to fetch clients:", error);
    return { success: false, error: "Failed to fetch clients" };
  }
}

/**
 * Create a new GHL client/workspace for the current user
 */
export async function createClient(data: ClientData) {
  try {
    const userId = await getCurrentUserId();

    if (!userId) {
      return { success: false, error: "Not authenticated" };
    }

    const name = data.name?.trim();
    const ghlLocationId = data.ghlLocationId?.trim();
    const ghlPrivateKey = data.ghlPrivateKey?.trim();
    const emailBisonApiKey = normalizeOptionalString(data.emailBisonApiKey);
    const emailBisonWorkspaceId = normalizeEmailBisonWorkspaceId(data.emailBisonWorkspaceId);
    const unipileAccountId = normalizeOptionalString(data.unipileAccountId);

    // Validate required fields
    if (!name || !ghlLocationId || !ghlPrivateKey) {
      return { success: false, error: "Missing required fields" };
    }

    const workspaceIdError = validateEmailBisonWorkspaceId(emailBisonWorkspaceId);
    if (workspaceIdError) {
      return { success: false, error: workspaceIdError };
    }

    // Check if location ID already exists
    const existing = await prisma.client.findUnique({
      where: { ghlLocationId },
    });

    if (existing) {
      return { success: false, error: "A workspace with this Location ID already exists" };
    }

    if (emailBisonWorkspaceId) {
      const existingWithWorkspaceId = await prisma.client.findUnique({
        where: { emailBisonWorkspaceId },
      });
      if (existingWithWorkspaceId) {
        return { success: false, error: "A workspace with this EmailBison Workspace ID already exists" };
      }
    }

    // Create the client/workspace with userId
    const client = await prisma.client.create({
      data: {
        name,
        ghlLocationId,
        ghlPrivateKey,
        emailBisonApiKey: emailBisonApiKey || null,
        emailBisonWorkspaceId: emailBisonWorkspaceId || null,
        unipileAccountId: unipileAccountId || null,
        userId, // Tie workspace to current user
      },
    });

    // Create default workspace settings
    await prisma.workspaceSettings.create({
      data: {
        clientId: client.id,
      },
    });

    revalidatePath("/");
    return { success: true, data: client };
  } catch (error) {
    console.error("Failed to create client:", error);
    return { success: false, error: "Failed to create workspace" };
  }
}

/**
 * Update an existing client/workspace (only if owned by current user)
 */
export async function updateClient(id: string, data: Partial<ClientData>) {
  try {
    const userId = await getCurrentUserId();

    if (!userId) {
      return { success: false, error: "Not authenticated" };
    }

    // Verify ownership before updating
    const client = await prisma.client.findFirst({
      where: { id, userId },
    });

    if (!client) {
      return { success: false, error: "Workspace not found or access denied" };
    }

    const name = normalizeOptionalString(data.name);
    const ghlLocationId = normalizeOptionalString(data.ghlLocationId);
    const ghlPrivateKey = normalizeOptionalString(data.ghlPrivateKey);
    const emailBisonApiKey = normalizeOptionalString(data.emailBisonApiKey);
    const emailBisonWorkspaceId = normalizeEmailBisonWorkspaceId(data.emailBisonWorkspaceId);
    const unipileAccountId = normalizeOptionalString(data.unipileAccountId);

    if (name !== undefined && !name) return { success: false, error: "Workspace name cannot be empty" };
    if (ghlLocationId !== undefined && !ghlLocationId) return { success: false, error: "GHL Location ID cannot be empty" };
    if (ghlPrivateKey !== undefined && !ghlPrivateKey) return { success: false, error: "GHL Private Integration Key cannot be empty" };

    const workspaceIdError = validateEmailBisonWorkspaceId(emailBisonWorkspaceId);
    if (workspaceIdError) {
      return { success: false, error: workspaceIdError };
    }

    // If ghlLocationId is being changed, check for uniqueness
    if (ghlLocationId !== undefined && ghlLocationId !== client.ghlLocationId) {
      const existingWithLocationId = await prisma.client.findUnique({
        where: { ghlLocationId },
      });
      if (existingWithLocationId) {
        return { success: false, error: "A workspace with this Location ID already exists" };
      }
    }

    // If emailBisonWorkspaceId is being changed, check for uniqueness
    if (emailBisonWorkspaceId !== undefined &&
      emailBisonWorkspaceId !== (client.emailBisonWorkspaceId || "") &&
      emailBisonWorkspaceId !== "") {
      const existingWithWorkspaceId = await prisma.client.findUnique({
        where: { emailBisonWorkspaceId },
      });
      if (existingWithWorkspaceId) {
        return { success: false, error: "A workspace with this EmailBison Workspace ID already exists" };
      }
    }

    // Build update data, only including fields that are provided
    const updateData: Record<string, string | null> = {};
    if (name !== undefined) updateData.name = name;
    if (ghlLocationId !== undefined) updateData.ghlLocationId = ghlLocationId;
    if (ghlPrivateKey !== undefined) updateData.ghlPrivateKey = ghlPrivateKey;
    if (data.emailBisonApiKey !== undefined) updateData.emailBisonApiKey = emailBisonApiKey || null;
    if (data.emailBisonWorkspaceId !== undefined) updateData.emailBisonWorkspaceId = emailBisonWorkspaceId || null;
    if (data.unipileAccountId !== undefined) updateData.unipileAccountId = unipileAccountId || null;

    const updatedClient = await prisma.client.update({
      where: { id },
      data: updateData,
    });

    revalidatePath("/");
    return { success: true, data: updatedClient };
  } catch (error) {
    console.error("Failed to update client:", error);
    return { success: false, error: "Failed to update workspace" };
  }
}

/**
 * Delete a GHL client/workspace by ID (only if owned by current user)
 */
export async function deleteClient(id: string) {
  try {
    const userId = await getCurrentUserId();

    if (!userId) {
      return { success: false, error: "Not authenticated" };
    }

    // Verify ownership before deleting
    const client = await prisma.client.findFirst({
      where: { id, userId },
    });

    if (!client) {
      return { success: false, error: "Workspace not found or access denied" };
    }

    await prisma.client.delete({
      where: { id },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to delete client:", error);
    return { success: false, error: "Failed to delete workspace" };
  }
}

/**
 * Get a single client by Location ID (used by webhook - no auth check)
 */
export async function getClientByLocationId(locationId: string) {
  try {
    const client = await prisma.client.findUnique({
      where: { ghlLocationId: locationId },
    });
    return client;
  } catch (error) {
    console.error("Failed to fetch client by location ID:", error);
    return null;
  }
}
