"use server";

import { prisma } from "@/lib/prisma";
import { getWorkflows } from "@/lib/ghl-api";
import { revalidatePath } from "next/cache";

interface CampaignData {
  id: string;
  ghlWorkflowId: string;
  name: string;
  status: string;
  clientId: string;
  clientName: string;
  leadCount: number;
  createdAt: Date;
}

/**
 * Get all campaigns for a client/workspace
 */
export async function getCampaigns(clientId?: string): Promise<{
  success: boolean;
  data?: CampaignData[];
  error?: string;
}> {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: clientId ? { clientId } : undefined,
      include: {
        client: {
          select: { name: true },
        },
        _count: {
          select: { leads: true },
        },
      },
      orderBy: { name: "asc" },
    });

    const formattedCampaigns: CampaignData[] = campaigns.map((c) => ({
      id: c.id,
      ghlWorkflowId: c.ghlWorkflowId,
      name: c.name,
      status: c.status,
      clientId: c.clientId,
      clientName: c.client.name,
      leadCount: c._count.leads,
      createdAt: c.createdAt,
    }));

    return { success: true, data: formattedCampaigns };
  } catch (error) {
    console.error("Failed to fetch campaigns:", error);
    return { success: false, error: "Failed to fetch campaigns" };
  }
}

/**
 * Sync workflows from GHL for a specific client
 */
export async function syncCampaignsFromGHL(clientId: string): Promise<{
  success: boolean;
  synced?: number;
  error?: string;
}> {
  try {
    // Get the client to get their GHL credentials
    const client = await prisma.client.findUnique({
      where: { id: clientId },
    });

    if (!client) {
      return { success: false, error: "Client not found" };
    }

    if (!client.ghlPrivateKey || !client.ghlLocationId) {
      return { success: false, error: "Client has no GHL credentials configured" };
    }

    // Fetch workflows from GHL API
    const result = await getWorkflows(client.ghlLocationId, client.ghlPrivateKey);

    if (!result.success || !result.data) {
      return { success: false, error: result.error || "Failed to fetch workflows from GHL" };
    }

    const workflows = result.data.workflows || [];
    let synced = 0;

    // Upsert each workflow as a campaign
    for (const workflow of workflows) {
      await prisma.campaign.upsert({
        where: { ghlWorkflowId: workflow.id },
        create: {
          ghlWorkflowId: workflow.id,
          name: workflow.name,
          status: workflow.status || "active",
          clientId: client.id,
        },
        update: {
          name: workflow.name,
          status: workflow.status || "active",
        },
      });
      synced++;
    }

    revalidatePath("/");

    return { success: true, synced };
  } catch (error) {
    console.error("Failed to sync campaigns from GHL:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Link a lead to a campaign
 */
export async function linkLeadToCampaign(
  leadId: string,
  campaignId: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.lead.update({
      where: { id: leadId },
      data: { campaignId },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to link lead to campaign:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Delete a campaign
 */
export async function deleteCampaign(campaignId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    // First, unlink all leads from this campaign
    await prisma.lead.updateMany({
      where: { campaignId },
      data: { campaignId: null },
    });

    // Then delete the campaign
    await prisma.campaign.delete({
      where: { id: campaignId },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to delete campaign:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}



