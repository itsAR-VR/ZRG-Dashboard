"use server";

import { prisma } from "@/lib/prisma";

export interface SmsCampaignListItem {
  id: string;
  name: string;
  leadCount: number;
}

export interface SmsCampaignFiltersData {
  campaigns: SmsCampaignListItem[];
  unattributedLeadCount: number;
}

export async function getSmsCampaignFilters(clientId: string): Promise<{
  success: boolean;
  data?: SmsCampaignFiltersData;
  error?: string;
}> {
  try {
    const [campaigns, unattributedLeadCount] = await Promise.all([
      prisma.smsCampaign.findMany({
        where: { clientId },
        select: {
          id: true,
          name: true,
          _count: { select: { leads: true } },
        },
        orderBy: { nameNormalized: "asc" },
      }),
      prisma.lead.count({
        where: { clientId, smsCampaignId: null },
      }),
    ]);

    return {
      success: true,
      data: {
        campaigns: campaigns.map((c) => ({
          id: c.id,
          name: c.name,
          leadCount: c._count.leads,
        })),
        unattributedLeadCount,
      },
    };
  } catch (error) {
    console.error("Failed to fetch SMS sub-clients:", error);
    return { success: false, error: "Failed to fetch SMS sub-clients" };
  }
}

