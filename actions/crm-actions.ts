"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export interface CRMLeadData {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string;
  title: string;
  status: string;
  leadScore: number;
  sentimentTag: string | null;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
}

/**
 * Get all leads for CRM view
 */
export async function getCRMLeads(): Promise<{
  success: boolean;
  data?: CRMLeadData[];
  error?: string;
}> {
  try {
    const leads = await prisma.lead.findMany({
      include: {
        client: {
          select: {
            name: true,
          },
        },
        _count: {
          select: { messages: true },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    const crmLeads: CRMLeadData[] = leads.map((lead) => {
      const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
      
      // Calculate a simple lead score based on available data
      let score = 50; // Base score
      if (lead.email) score += 10;
      if (lead.phone) score += 10;
      if (lead.sentimentTag === "Meeting Requested") score += 20;
      if (lead.sentimentTag === "Positive") score += 15;
      if (lead.sentimentTag === "Information Requested") score += 10;
      if (lead.sentimentTag === "Not Interested") score -= 20;
      if (lead.sentimentTag === "Blacklist") score -= 40;
      score = Math.max(0, Math.min(100, score)); // Clamp between 0-100

      return {
        id: lead.id,
        name: fullName,
        email: lead.email,
        phone: lead.phone,
        company: lead.client.name,
        title: "", // Not in current schema
        status: lead.status,
        leadScore: score,
        sentimentTag: lead.sentimentTag,
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
        messageCount: lead._count.messages,
      };
    });

    return { success: true, data: crmLeads };
  } catch (error) {
    console.error("Failed to fetch CRM leads:", error);
    return { success: false, error: "Failed to fetch leads" };
  }
}

/**
 * Update lead status
 */
export async function updateLeadStatus(
  leadId: string,
  status: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.lead.update({
      where: { id: leadId },
      data: { status },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to update lead status:", error);
    return { success: false, error: "Failed to update status" };
  }
}

/**
 * Delete a lead
 */
export async function deleteLead(
  leadId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.lead.delete({
      where: { id: leadId },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to delete lead:", error);
    return { success: false, error: "Failed to delete lead" };
  }
}

/**
 * Get a single lead with full details
 */
export async function getLeadDetails(leadId: string) {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        client: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
    });

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }

    return {
      success: true,
      data: {
        id: lead.id,
        name: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown",
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email,
        phone: lead.phone,
        company: lead.client.name,
        status: lead.status,
        sentimentTag: lead.sentimentTag,
        messages: lead.messages,
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
      },
    };
  } catch (error) {
    console.error("Failed to fetch lead details:", error);
    return { success: false, error: "Failed to fetch lead" };
  }
}

