"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export interface CRMLeadData {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string;
  smsCampaignId: string | null;
  smsCampaignName: string | null;
  title: string;
  status: string;
  leadScore: number;
  sentimentTag: string | null;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  autoReplyEnabled: boolean;
  autoFollowUpEnabled: boolean;
  // Enrichment data
  linkedinUrl: string | null;
  companyName: string | null;
  companyWebsite: string | null;
  companyState: string | null;
  emailBisonLeadId: string | null;
  enrichmentStatus: string | null;
  // GHL integration data
  ghlContactId: string | null;
  ghlLocationId: string | null;
}

/**
 * Get all leads for CRM view
 * @param clientId - Optional workspace ID to filter leads by
 */
export async function getCRMLeads(clientId?: string | null): Promise<{
  success: boolean;
  data?: CRMLeadData[];
  error?: string;
}> {
  try {
    const leads = await prisma.lead.findMany({
      where: clientId ? { clientId } : undefined,
      include: {
        client: {
          select: {
            name: true,
            ghlLocationId: true,
          },
        },
        smsCampaign: {
          select: {
            id: true,
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
        smsCampaignId: lead.smsCampaignId,
        smsCampaignName: lead.smsCampaign?.name ?? null,
        title: "", // Not in current schema
        status: lead.status,
        leadScore: score,
        sentimentTag: lead.sentimentTag,
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
        messageCount: lead._count.messages,
        autoReplyEnabled: lead.autoReplyEnabled,
        autoFollowUpEnabled: lead.autoFollowUpEnabled,
        // Enrichment data
        linkedinUrl: lead.linkedinUrl,
        companyName: lead.companyName,
        companyWebsite: lead.companyWebsite,
        companyState: lead.companyState,
        emailBisonLeadId: lead.emailBisonLeadId,
        enrichmentStatus: lead.enrichmentStatus,
        // GHL integration data
        ghlContactId: lead.ghlContactId,
        ghlLocationId: lead.client.ghlLocationId,
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
 * Update lead automation settings
 */
export async function updateLeadAutomationSettings(
  leadId: string,
  settings: {
    autoReplyEnabled?: boolean;
    autoFollowUpEnabled?: boolean;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.lead.update({
      where: { id: leadId },
      data: settings,
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to update lead automation settings:", error);
    return { success: false, error: "Failed to update settings" };
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
        snoozedUntil: lead.snoozedUntil,
        messages: lead.messages,
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
        autoReplyEnabled: lead.autoReplyEnabled,
        autoFollowUpEnabled: lead.autoFollowUpEnabled,
      },
    };
  } catch (error) {
    console.error("Failed to fetch lead details:", error);
    return { success: false, error: "Failed to fetch lead" };
  }
}

/**
 * Snooze a lead for a specified number of days
 * The lead won't appear in the inbox until the snooze period expires
 */
export async function snoozeLead(
  leadId: string,
  days: number = 2
): Promise<{ success: boolean; snoozedUntil?: Date; error?: string }> {
  try {
    const snoozedUntil = new Date();
    snoozedUntil.setDate(snoozedUntil.getDate() + days);

    await prisma.lead.update({
      where: { id: leadId },
      data: { snoozedUntil },
    });

    revalidatePath("/");
    return { success: true, snoozedUntil };
  } catch (error) {
    console.error("Failed to snooze lead:", error);
    return { success: false, error: "Failed to snooze lead" };
  }
}

/**
 * Unsnooze a lead (remove snooze period)
 */
export async function unsnoozeLead(
  leadId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.lead.update({
      where: { id: leadId },
      data: { snoozedUntil: null },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to unsnooze lead:", error);
    return { success: false, error: "Failed to unsnooze lead" };
  }
}

/**
 * Book a meeting for a lead (updates status to meeting-booked)
 */
export async function bookMeeting(
  leadId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.lead.update({
      where: { id: leadId },
      data: { status: "meeting-booked" },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to book meeting:", error);
    return { success: false, error: "Failed to book meeting" };
  }
}

// =============================================================================
// Cursor-Based Pagination for CRM (Performance Optimized)
// =============================================================================

export interface CRMLeadsCursorOptions {
  clientId?: string | null;
  cursor?: string | null; // Lead ID to start after
  limit?: number;
  search?: string;
  status?: string;
  sortField?: "updatedAt" | "firstName" | "leadScore";
  sortDirection?: "asc" | "desc";
}

export interface CRMLeadsCursorResult {
  success: boolean;
  leads: CRMLeadData[];
  nextCursor: string | null;
  hasMore: boolean;
  error?: string;
}

/**
 * Helper function to calculate lead score
 */
function calculateLeadScore(lead: {
  email: string | null;
  phone: string | null;
  sentimentTag: string | null;
}): number {
  let score = 50; // Base score
  if (lead.email) score += 10;
  if (lead.phone) score += 10;
  if (lead.sentimentTag === "Meeting Requested") score += 20;
  if (lead.sentimentTag === "Positive") score += 15;
  if (lead.sentimentTag === "Information Requested") score += 10;
  if (lead.sentimentTag === "Not Interested") score -= 20;
  if (lead.sentimentTag === "Blacklist") score -= 40;
  return Math.max(0, Math.min(100, score)); // Clamp between 0-100
}

/**
 * Transform Prisma lead to CRMLeadData
 */
function transformLeadToCRM(lead: any): CRMLeadData {
  const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";

  return {
    id: lead.id,
    name: fullName,
    email: lead.email,
    phone: lead.phone,
    company: lead.client.name,
    smsCampaignId: lead.smsCampaignId,
    smsCampaignName: lead.smsCampaign?.name ?? null,
    title: "", // Not in current schema
    status: lead.status,
    leadScore: calculateLeadScore(lead),
    sentimentTag: lead.sentimentTag,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
    messageCount: lead._count.messages,
    autoReplyEnabled: lead.autoReplyEnabled,
    autoFollowUpEnabled: lead.autoFollowUpEnabled,
    // Enrichment data
    linkedinUrl: lead.linkedinUrl,
    companyName: lead.companyName,
    companyWebsite: lead.companyWebsite,
    companyState: lead.companyState,
    emailBisonLeadId: lead.emailBisonLeadId,
    enrichmentStatus: lead.enrichmentStatus,
    // GHL integration data
    ghlContactId: lead.ghlContactId,
    ghlLocationId: lead.client.ghlLocationId,
  };
}

/**
 * Get CRM leads with cursor-based pagination
 * Optimized for large datasets (50,000+ leads)
 */
export async function getCRMLeadsCursor(
  options: CRMLeadsCursorOptions
): Promise<CRMLeadsCursorResult> {
  try {
    const {
      clientId,
      cursor,
      limit = 50,
      search,
      status,
      sortField = "updatedAt",
      sortDirection = "desc",
    } = options;

    // Build the where clause for filtering
    const whereConditions: any[] = [];

    if (clientId) {
      whereConditions.push({ clientId });
    }

    if (status && status !== "all") {
      whereConditions.push({ status });
    }

    if (search && search.trim()) {
      const searchTerm = search.trim();
      whereConditions.push({
        OR: [
          { firstName: { contains: searchTerm, mode: "insensitive" } },
          { lastName: { contains: searchTerm, mode: "insensitive" } },
          { email: { contains: searchTerm, mode: "insensitive" } },
          { companyName: { contains: searchTerm, mode: "insensitive" } },
          { smsCampaign: { is: { name: { contains: searchTerm, mode: "insensitive" } } } },
        ],
      });
    }

    const where = whereConditions.length > 0
      ? { AND: whereConditions }
      : undefined;

    // Build query with cursor pagination
    const queryOptions: any = {
      where,
      take: limit + 1, // Fetch one extra to check if there are more
      orderBy: { [sortField]: sortDirection },
      include: {
        client: {
          select: {
            name: true,
            ghlLocationId: true,
          },
        },
        smsCampaign: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: { messages: true },
        },
      },
    };

    // Add cursor if provided (for subsequent pages)
    if (cursor) {
      queryOptions.cursor = { id: cursor };
      queryOptions.skip = 1; // Skip the cursor record itself
    }

    const leads = await prisma.lead.findMany(queryOptions);

    // Check if there are more records
    const hasMore = leads.length > limit;
    const resultLeads = hasMore ? leads.slice(0, -1) : leads;
    const nextCursor = hasMore && resultLeads.length > 0
      ? resultLeads[resultLeads.length - 1].id
      : null;

    // Transform to CRM format
    const crmLeads = resultLeads.map(transformLeadToCRM);

    return {
      success: true,
      leads: crmLeads,
      nextCursor,
      hasMore,
    };
  } catch (error) {
    console.error("Failed to fetch CRM leads with cursor:", error);
    return {
      success: false,
      leads: [],
      nextCursor: null,
      hasMore: false,
      error: "Failed to fetch leads",
    };
  }
}

/**
 * Get CRM leads from the end of the list (for "Jump to Bottom" feature)
 * Returns leads in reverse order (most recent at bottom)
 */
export async function getCRMLeadsFromEnd(
  options: Omit<CRMLeadsCursorOptions, "cursor" | "sortDirection">
): Promise<CRMLeadsCursorResult> {
  try {
    const {
      clientId,
      limit = 50,
      search,
      status,
      sortField = "updatedAt",
    } = options;

    // Build the where clause
    const whereConditions: any[] = [];

    if (clientId) {
      whereConditions.push({ clientId });
    }

    if (status && status !== "all") {
      whereConditions.push({ status });
    }

    if (search && search.trim()) {
      const searchTerm = search.trim();
      whereConditions.push({
        OR: [
          { firstName: { contains: searchTerm, mode: "insensitive" } },
          { lastName: { contains: searchTerm, mode: "insensitive" } },
          { email: { contains: searchTerm, mode: "insensitive" } },
          { companyName: { contains: searchTerm, mode: "insensitive" } },
          { smsCampaign: { is: { name: { contains: searchTerm, mode: "insensitive" } } } },
        ],
      });
    }

    const where = whereConditions.length > 0
      ? { AND: whereConditions }
      : undefined;

    // Fetch from the "end" by reversing sort order
    const leads = await prisma.lead.findMany({
      where,
      take: limit,
      orderBy: { [sortField]: "asc" }, // Reverse order to get oldest/lowest first
      include: {
        client: {
          select: {
            name: true,
            ghlLocationId: true,
          },
        },
        smsCampaign: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: { messages: true },
        },
      },
    });

    // Reverse to get correct display order (most recent/highest at bottom)
    const reversedLeads = leads.reverse();

    // Transform to CRM format
    const crmLeads = reversedLeads.map(transformLeadToCRM);

    // The first item becomes the cursor for loading more (going "up")
    const nextCursor = reversedLeads.length > 0 ? reversedLeads[0].id : null;

    return {
      success: true,
      leads: crmLeads,
      nextCursor,
      hasMore: leads.length === limit, // If we got full page, there might be more
    };
  } catch (error) {
    console.error("Failed to fetch CRM leads from end:", error);
    return {
      success: false,
      leads: [],
      nextCursor: null,
      hasMore: false,
      error: "Failed to fetch leads",
    };
  }
}
