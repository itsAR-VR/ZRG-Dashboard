"use server";

import { prisma } from "@/lib/prisma";
import { fetchEmailBisonCampaigns } from "@/lib/emailbison-api";
import { revalidatePath } from "next/cache";

interface EmailCampaignData {
  id: string;
  bisonCampaignId: string;
  name: string;
  clientId: string;
  clientName: string;
  leadCount: number;
  createdAt: Date;
}

export async function getEmailCampaigns(clientId?: string): Promise<{
  success: boolean;
  data?: EmailCampaignData[];
  error?: string;
}> {
  try {
    const campaigns = await prisma.emailCampaign.findMany({
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

    const formatted: EmailCampaignData[] = campaigns.map((c) => ({
      id: c.id,
      bisonCampaignId: c.bisonCampaignId,
      name: c.name,
      clientId: c.clientId,
      clientName: c.client.name,
      leadCount: c._count.leads,
      createdAt: c.createdAt,
    }));

    return { success: true, data: formatted };
  } catch (error) {
    console.error("[EmailCampaign] Failed to fetch campaigns:", error);
    return { success: false, error: "Failed to fetch email campaigns" };
  }
}

export async function syncEmailCampaignsFromEmailBison(clientId: string): Promise<{
  success: boolean;
  synced?: number;
  error?: string;
}> {
  try {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
    });

    if (!client) {
      return { success: false, error: "Client not found" };
    }

    if (!client.emailBisonApiKey || !client.emailBisonInstanceUrl) {
      return { success: false, error: "Client missing EmailBison credentials" };
    }

    const campaignsResult = await fetchEmailBisonCampaigns(
      client.emailBisonInstanceUrl,
      client.emailBisonApiKey
    );

    if (!campaignsResult.success || !campaignsResult.data) {
      return { success: false, error: campaignsResult.error || "Failed to fetch EmailBison campaigns" };
    }

    let synced = 0;
    for (const campaign of campaignsResult.data) {
      await prisma.emailCampaign.upsert({
        where: {
          clientId_bisonCampaignId: {
            clientId: client.id,
            bisonCampaignId: campaign.id,
          },
        },
        create: {
          clientId: client.id,
          bisonCampaignId: campaign.id,
          name: campaign.name,
        },
        update: {
          name: campaign.name,
        },
      });
      synced++;
    }

    revalidatePath("/");

    return { success: true, synced };
  } catch (error) {
    console.error("[EmailCampaign] Failed to sync campaigns:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function linkLeadToEmailCampaign(
  leadId: string,
  emailCampaignId: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.lead.update({
      where: { id: leadId },
      data: { emailCampaignId },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("[EmailCampaign] Failed to link lead:", error);
    return { success: false, error: "Failed to link lead to email campaign" };
  }
}
