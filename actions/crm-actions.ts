"use server";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { autoStartNoResponseSequenceOnOutbound } from "@/lib/followup-automation";
import { pauseFollowUpsOnBooking } from "@/lib/followup-engine";
import { shouldGenerateDraft } from "@/lib/ai-drafts";
import { isPositiveSentiment, SENTIMENT_TAGS, type SentimentTag } from "@/lib/sentiment-shared";
import { requireClientAccess, requireClientAdminAccess, requireLeadAccessById, resolveClientScope } from "@/lib/workspace-access";

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
  sentimentTag: string | null;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  autoReplyEnabled: boolean;
  autoFollowUpEnabled: boolean;
  smsDndActive: boolean;
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
  // Lead scoring (Phase 33)
  overallScore: number | null;
  scoredAt: Date | null;
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
    const scope = await resolveClientScope(clientId);
    if (scope.clientIds.length === 0) return { success: true, data: [] };
    const leads = await prisma.lead.findMany({
      where: { clientId: { in: scope.clientIds } },
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
        sentimentTag: lead.sentimentTag,
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
        messageCount: lead._count.messages,
        autoReplyEnabled: lead.autoReplyEnabled,
        autoFollowUpEnabled: lead.autoFollowUpEnabled,
        smsDndActive: lead.smsDndActive,
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
        // Lead scoring (Phase 33)
        overallScore: lead.overallScore,
        scoredAt: lead.scoredAt,
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
    await requireLeadAccessById(leadId);
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
 * Manually set a lead's sentiment tag.
 */
export async function updateLeadSentimentTag(
  leadId: string,
  sentimentTag: string
): Promise<{ success: boolean; sentimentTag?: string; error?: string }> {
  try {
    await requireLeadAccessById(leadId);
    const nextTag = sentimentTag as SentimentTag;
    if (!SENTIMENT_TAGS.includes(nextTag)) {
      return { success: false, error: "Invalid sentiment tag" };
    }

    const updatedLead = await prisma.lead.update({
      where: { id: leadId },
      data: {
        sentimentTag: nextTag,
      },
      select: {
        email: true,
      },
    });

    // Keep system policies consistent with sentiment changes.
    // If sentiment is no longer positive, don't leave enrichment stuck in "pending".
    if (!isPositiveSentiment(nextTag)) {
      await prisma.lead.updateMany({
        where: { id: leadId, enrichmentStatus: "pending" },
        data: { enrichmentStatus: "not_needed" },
      });
    }

    // Draft policy/backstop: only generate drafts for eligible sentiments.
    if (!shouldGenerateDraft(nextTag, updatedLead.email)) {
      await prisma.aIDraft.updateMany({
        where: {
          leadId,
          status: "pending",
        },
        data: { status: "rejected" },
      });
    }

    revalidatePath("/");
    return { success: true, sentimentTag: nextTag };
  } catch (error) {
    console.error("Failed to update lead sentiment tag:", error);
    return { success: false, error: "Failed to update sentiment tag" };
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
    await requireLeadAccessById(leadId);
    const before = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        autoFollowUpEnabled: true,
      },
    });

    await prisma.lead.update({
      where: { id: leadId },
      data: settings,
    });

    // If follow-ups were just enabled, try to start the no-response sequence based on the last outbound touch.
    // This helps "Previously Required Attention" leads begin sequencing immediately after being enrolled.
    if (settings.autoFollowUpEnabled === true && before && !before.autoFollowUpEnabled) {
      const lastMessage = await prisma.message.findFirst({
        where: { leadId },
        orderBy: { sentAt: "desc" },
        select: { direction: true, sentAt: true },
      });

      if (lastMessage?.direction === "outbound") {
        autoStartNoResponseSequenceOnOutbound({ leadId, outboundAt: lastMessage.sentAt }).catch((err) => {
          console.error("[CRM] Failed to auto-start no-response sequence on enable:", err);
        });
      }
    }

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to update lead automation settings:", error);
    return { success: false, error: "Failed to update settings" };
  }
}

/**
 * Bulk-enable auto follow-ups for leads that require attention / are positive.
 *
 * This is intentionally conservative: it only enables, and only for a safe allow-list
 * of sentiment tags. It does not change leads outside this allow-list.
 */
export async function enableAutoFollowUpsForAttentionLeads(
  clientId: string
): Promise<{
  success: boolean;
  eligible?: number;
  enabledNow?: number;
  alreadyEnabled?: number;
  error?: string;
}> {
  try {
    if (!clientId) {
      return { success: false, error: "No workspace selected" };
    }
    await requireClientAccess(clientId);

    // Keep this list aligned with what the UI considers "requires attention".
    // Includes "Positive" for legacy rows.
    const eligibleSentiments: string[] = [
      "Meeting Requested",
      "Call Requested",
      "Information Requested",
      "Interested",
      "Follow Up",
      "Positive",
    ];

    const whereEligible = {
      clientId,
      status: { notIn: ["blacklisted", "unqualified"] },
      sentimentTag: { in: eligibleSentiments },
    };

    const [eligible, alreadyEnabled, updateResult] = await Promise.all([
      prisma.lead.count({ where: whereEligible }),
      prisma.lead.count({
        where: {
          ...whereEligible,
          autoFollowUpEnabled: true,
        },
      }),
      prisma.lead.updateMany({
        where: {
          ...whereEligible,
          autoFollowUpEnabled: false,
        },
        data: { autoFollowUpEnabled: true },
      }),
    ]);

    revalidatePath("/");
    return {
      success: true,
      eligible,
      alreadyEnabled,
      enabledNow: updateResult.count,
    };
  } catch (error) {
    console.error("Failed to bulk enable auto follow-ups:", error);
    return { success: false, error: "Failed to enable auto follow-ups" };
  }
}

/**
 * Backfill no-response follow-up instances for "awaiting reply" leads:
 * - Lead has inbound history
 * - Latest message is outbound (we're the latest toucher)
 * - Lead is positive / qualified
 *
 * This is useful when auto-followups were enabled after leads had already replied,
 * or when leads were never auto-enrolled.
 */
export async function backfillNoResponseFollowUpsForAwaitingReplyLeads(
  clientId: string,
  opts?: { limit?: number }
): Promise<{
  success: boolean;
  checked?: number;
  enabledNow?: number;
  started?: number;
  reasons?: Record<string, number>;
  error?: string;
}> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireClientAdminAccess(clientId);

    const limit = opts?.limit ?? 200;
    const now = new Date();

    const positiveSentiments: string[] = [
      "Meeting Requested",
      "Call Requested",
      "Information Requested",
      "Interested",
      "Positive", // legacy
    ];

    // Pull a bounded set of candidate leads; we validate latest message direction and inbound history using Messages
    // so we don't rely on denormalized rollups being perfect.
    const candidateLeads = await prisma.lead.findMany({
      where: {
        clientId,
        status: { notIn: ["blacklisted", "unqualified"] },
        sentimentTag: { in: positiveSentiments },
        OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
      },
      take: limit,
      select: {
        id: true,
        autoFollowUpEnabled: true,
        lastMessageAt: true,
        updatedAt: true,
      },
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
    });

    if (candidateLeads.length === 0) {
      return { success: true, checked: 0, enabledNow: 0, started: 0, reasons: {} };
    }

    let enabledNow = 0;
    let started = 0;
    const reasons: Record<string, number> = {};

    for (const lead of candidateLeads) {
      const lastMessage = await prisma.message.findFirst({
        where: { leadId: lead.id },
        orderBy: { sentAt: "desc" },
        select: { direction: true, sentAt: true },
      });

      if (!lastMessage) {
        reasons.no_messages = (reasons.no_messages ?? 0) + 1;
        continue;
      }

      if (lastMessage.direction !== "outbound") {
        reasons.latest_message_not_outbound = (reasons.latest_message_not_outbound ?? 0) + 1;
        continue;
      }

      const hasInbound = await prisma.message.findFirst({
        where: { leadId: lead.id, direction: "inbound" },
        select: { id: true },
      });

      if (!hasInbound) {
        reasons.no_inbound_history = (reasons.no_inbound_history ?? 0) + 1;
        continue;
      }

      if (!lead.autoFollowUpEnabled) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: { autoFollowUpEnabled: true },
        });
        enabledNow++;
      }

      const res = await autoStartNoResponseSequenceOnOutbound({ leadId: lead.id, outboundAt: lastMessage.sentAt });
      if (res.started) started++;
      if (res.reason) reasons[res.reason] = (reasons[res.reason] ?? 0) + 1;
    }

    revalidatePath("/");
    return {
      success: true,
      checked: candidateLeads.length,
      enabledNow,
      started,
      reasons,
    };
  } catch (error) {
    console.error("Failed to backfill no-response follow-ups:", error);
    return { success: false, error: "Failed to backfill follow-ups" };
  }
}

/**
 * Delete a lead
 */
export async function deleteLead(
  leadId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { clientId } = await requireLeadAccessById(leadId);
    await requireClientAdminAccess(clientId);
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
    await requireLeadAccessById(leadId);
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
    const snoozedUntil = new Date(Date.now() + Math.max(0, Math.trunc(days)) * 24 * 60 * 60 * 1000);
    return snoozeLeadUntil(leadId, snoozedUntil.toISOString());
  } catch (error) {
    console.error("Failed to snooze lead:", error);
    return { success: false, error: "Failed to snooze lead" };
  }
}

/**
 * Snooze a lead until an exact date/time (ISO string).
 * This enables longer/explicit snoozes (e.g., > 2 weeks).
 */
export async function snoozeLeadUntil(
  leadId: string,
  snoozedUntilIso: string
): Promise<{ success: boolean; snoozedUntil?: Date; error?: string }> {
  try {
    await requireLeadAccessById(leadId);
    const snoozedUntil = new Date(snoozedUntilIso);
    if (Number.isNaN(snoozedUntil.getTime())) {
      return { success: false, error: "Invalid snooze date" };
    }

    const now = new Date();
    if (snoozedUntil <= now) {
      return { success: false, error: "Snooze date must be in the future" };
    }

    await prisma.lead.update({
      where: { id: leadId },
      data: { snoozedUntil },
    });

    // Pause follow-up instances until snooze expires (resume at next step).
    await prisma.followUpInstance.updateMany({
      where: {
        leadId,
        OR: [{ status: "active" }, { status: "paused", pausedReason: "lead_replied" }],
      },
      data: {
        status: "paused",
        pausedReason: "lead_snoozed",
        nextStepDue: snoozedUntil,
      },
    });

    revalidatePath("/");
    return { success: true, snoozedUntil };
  } catch (error) {
    console.error("Failed to snooze lead until:", error);
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
    await requireLeadAccessById(leadId);
    await prisma.lead.update({
      where: { id: leadId },
      data: { snoozedUntil: null },
    });

    // Resume sequences that were paused due to snooze.
    await prisma.followUpInstance.updateMany({
      where: { leadId, status: "paused", pausedReason: "lead_snoozed" },
      data: { status: "active", pausedReason: null, nextStepDue: new Date() },
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
    await requireLeadAccessById(leadId);
    await prisma.lead.update({
      where: { id: leadId },
      data: { status: "meeting-booked" },
    });

    await pauseFollowUpsOnBooking(leadId, { mode: "complete" });

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
  sortField?: "updatedAt" | "firstName" | "overallScore";
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
    sentimentTag: lead.sentimentTag,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
    messageCount: lead._count.messages,
    autoReplyEnabled: lead.autoReplyEnabled,
    autoFollowUpEnabled: lead.autoFollowUpEnabled,
    smsDndActive: lead.smsDndActive,
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
    // Lead scoring (Phase 33)
    overallScore: lead.overallScore,
    scoredAt: lead.scoredAt,
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

    const scope = await resolveClientScope(clientId);
    if (scope.clientIds.length === 0) {
      return { success: true, leads: [], nextCursor: null, hasMore: false };
    }

    // Build the where clause for filtering
    const whereConditions: any[] = [];

    whereConditions.push({ clientId: { in: scope.clientIds } });

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
    const sortOrder = sortDirection as Prisma.SortOrder;
    const scoreNullsOrder: Prisma.NullsOrder = sortDirection === "desc" ? "last" : "first";

    const orderBy: Prisma.LeadOrderByWithRelationInput[] =
      sortField === "overallScore"
        ? [
            { overallScore: { sort: sortOrder, nulls: scoreNullsOrder } },
            { updatedAt: "desc" },
            { id: "desc" },
          ]
        : sortField === "updatedAt"
          ? [{ updatedAt: sortOrder }, { id: "desc" }]
          : [{ [sortField]: sortOrder } as Prisma.LeadOrderByWithRelationInput, { updatedAt: "desc" }, { id: "desc" }];

    const queryOptions: any = {
      where,
      take: limit + 1, // Fetch one extra to check if there are more
      orderBy,
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

    const scope = await resolveClientScope(clientId);
    if (scope.clientIds.length === 0) {
      return { success: true, leads: [], nextCursor: null, hasMore: false };
    }

    // Build the where clause
    const whereConditions: any[] = [];

    whereConditions.push({ clientId: { in: scope.clientIds } });

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
    const orderBy: Prisma.LeadOrderByWithRelationInput[] =
      sortField === "overallScore"
        ? [
            { overallScore: { sort: "asc", nulls: "first" } },
            { updatedAt: "asc" },
            { id: "asc" },
          ]
        : sortField === "updatedAt"
          ? [{ updatedAt: "asc" }, { id: "asc" }]
          : [{ [sortField]: "asc" } as Prisma.LeadOrderByWithRelationInput, { updatedAt: "asc" }, { id: "asc" }];

    const leads = await prisma.lead.findMany({
      where,
      take: limit,
      orderBy, // Reverse order to get oldest/lowest first
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
