"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export interface ClientData {
  name: string;
  ghlLocationId: string;
  ghlPrivateKey: string;
  workspaceId?: string;
}

/**
 * Fetch all GHL clients from the database
 */
export async function getClients() {
  try {
    const clients = await prisma.client.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        ghlLocationId: true,
        workspaceId: true,
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
 * Create a new GHL client
 */
export async function createClient(data: ClientData) {
  try {
    // Validate required fields
    if (!data.name || !data.ghlLocationId || !data.ghlPrivateKey) {
      return { success: false, error: "Missing required fields" };
    }

    // Check if location ID already exists
    const existing = await prisma.client.findUnique({
      where: { ghlLocationId: data.ghlLocationId },
    });

    if (existing) {
      return { success: false, error: "A client with this Location ID already exists" };
    }

    const client = await prisma.client.create({
      data: {
        name: data.name,
        ghlLocationId: data.ghlLocationId,
        ghlPrivateKey: data.ghlPrivateKey,
        workspaceId: data.workspaceId || "default",
      },
    });

    revalidatePath("/");
    return { success: true, data: client };
  } catch (error) {
    console.error("Failed to create client:", error);
    return { success: false, error: "Failed to create client" };
  }
}

/**
 * Delete a GHL client by ID
 */
export async function deleteClient(id: string) {
  try {
    await prisma.client.delete({
      where: { id },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to delete client:", error);
    return { success: false, error: "Failed to delete client" };
  }
}

/**
 * Get a single client by Location ID (used by webhook)
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

