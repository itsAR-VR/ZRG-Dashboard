"use server";

import { prisma } from "@/lib/prisma";
import { fetchEmailBisonCampaigns } from "@/lib/emailbison-api";
import { revalidatePath } from "next/cache";
import { requireClientAdminAccess, requireLeadAccessById, resolveClientScope } from "@/lib/workspace-access";
import { CampaignResponseMode } from "@prisma/client";

interface EmailCampaignData {
  id: string;
  bisonCampaignId: string;
  name: string;
  clientId: string;
  clientName: string;
  leadCount: number;
  responseMode: CampaignResponseMode;
  autoSendConfidenceThreshold: number;
  createdAt: Date;
}

export async function getEmailCampaigns(clientId?: string): Promise<{
  success: boolean;
  data?: EmailCampaignData[];
  error?: string;
}> {
  try {
    const scope = await resolveClientScope(clientId ?? null);
    if (scope.clientIds.length === 0) return { success: true, data: [] };
    const campaigns = await prisma.emailCampaign.findMany({
      where: { clientId: { in: scope.clientIds } },
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
      responseMode: c.responseMode,
      autoSendConfidenceThreshold: c.autoSendConfidenceThreshold,
      createdAt: c.createdAt,
    }));

    return { success: true, data: formatted };
  } catch (error) {
    console.error("[EmailCampaign] Failed to fetch campaigns:", error);
    return { success: false, error: "Failed to fetch email campaigns" };
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export async function updateEmailCampaignConfig(
  emailCampaignId: string,
  opts: { responseMode?: CampaignResponseMode; autoSendConfidenceThreshold?: number }
): Promise<{
  success: boolean;
  data?: { responseMode: CampaignResponseMode; autoSendConfidenceThreshold: number };
  error?: string;
}> {
  try {
    const campaign = await prisma.emailCampaign.findUnique({
      where: { id: emailCampaignId },
      select: { clientId: true },
    });
    if (!campaign) return { success: false, error: "Email campaign not found" };

    await requireClientAdminAccess(campaign.clientId);

    const data: {
      responseMode?: CampaignResponseMode;
      autoSendConfidenceThreshold?: number;
    } = {};

    if (opts.responseMode) data.responseMode = opts.responseMode;

    if (opts.autoSendConfidenceThreshold !== undefined) {
      const normalized = clamp01(Number(opts.autoSendConfidenceThreshold));
      data.autoSendConfidenceThreshold = normalized;
    }

    const updated = await prisma.emailCampaign.update({
      where: { id: emailCampaignId },
      data,
      select: { responseMode: true, autoSendConfidenceThreshold: true },
    });

    revalidatePath("/");

    return {
      success: true,
      data: {
        responseMode: updated.responseMode,
        autoSendConfidenceThreshold: updated.autoSendConfidenceThreshold,
      },
    };
  } catch (error) {
    console.error("[EmailCampaign] Failed to update config:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update email campaign config",
    };
  }
}

export async function syncEmailCampaignsFromEmailBison(clientId: string): Promise<{
  success: boolean;
  synced?: number;
  error?: string;
}> {
  try {
    await requireClientAdminAccess(clientId);
    const client = await prisma.client.findUnique({
      where: { id: clientId },
    });

    if (!client) {
      return { success: false, error: "Client not found" };
    }

    if (!client.emailBisonApiKey) {
      return { success: false, error: "Client missing EmailBison credentials" };
    }

    const campaignsResult = await fetchEmailBisonCampaigns(client.emailBisonApiKey);

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
    const { clientId } = await requireLeadAccessById(leadId);
    if (emailCampaignId) {
      const campaign = await prisma.emailCampaign.findUnique({
        where: { id: emailCampaignId },
        select: { clientId: true },
      });
      if (!campaign) return { success: false, error: "Email campaign not found" };
      if (campaign.clientId !== clientId) return { success: false, error: "Email campaign does not belong to this workspace" };
    }

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
