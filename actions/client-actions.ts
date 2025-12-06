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

    // Validate required fields
    if (!data.name || !data.ghlLocationId || !data.ghlPrivateKey) {
      return { success: false, error: "Missing required fields" };
    }

    // Check if location ID already exists
    const existing = await prisma.client.findUnique({
      where: { ghlLocationId: data.ghlLocationId },
    });

    if (existing) {
      return { success: false, error: "A workspace with this Location ID already exists" };
    }

    // Create the client/workspace with userId
    const client = await prisma.client.create({
      data: {
        name: data.name,
        ghlLocationId: data.ghlLocationId,
        ghlPrivateKey: data.ghlPrivateKey,
        emailBisonApiKey: data.emailBisonApiKey || null,
        emailBisonWorkspaceId: data.emailBisonWorkspaceId || null,
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

    // Build update data, only including fields that are provided
    const updateData: Record<string, string | null> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.ghlPrivateKey !== undefined) updateData.ghlPrivateKey = data.ghlPrivateKey;
    if (data.emailBisonApiKey !== undefined) updateData.emailBisonApiKey = data.emailBisonApiKey || null;
    if (data.emailBisonWorkspaceId !== undefined) updateData.emailBisonWorkspaceId = data.emailBisonWorkspaceId || null;

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
