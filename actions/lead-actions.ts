"use server";

import { prisma } from "@/lib/prisma";
import { getAvailableChannels } from "@/lib/lead-matching";
import { getAccessibleClientIdsForUser, requireAuthUser, resolveClientScope } from "@/lib/workspace-access";

export type Channel = "sms" | "email" | "linkedin";

export interface ConversationData {
  id: string;
  lead: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    company: string;
    title: string;
    status: string;
    autoReplyEnabled: boolean;
    autoFollowUpEnabled: boolean;
    autoBookMeetingsEnabled: boolean;
    smsDndActive: boolean;
    clientId: string;  // For follow-up sequence management
    smsCampaignId: string | null;
    smsCampaignName: string | null;
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
  };
  channels: Channel[];           // All channels this lead has messages on
  availableChannels: Channel[];  // Channels available based on contact info
  primaryChannel: Channel;       // Most recent/active channel
  classification: string;
  lastMessage: string;
  lastSubject?: string | null;
  lastMessageTime: Date;
  hasAiDraft: boolean;
  requiresAttention: boolean;
  sentimentTag: string | null;
  campaignId: string | null;
  emailCampaignId: string | null;
}

/**
 * Map database sentiment tags to UI classification
 */
function mapSentimentToClassification(sentimentTag: string | null): string {
  const mapping: Record<string, string> = {
    "Meeting Requested": "meeting-requested",
    "Call Requested": "call-requested",
    "Not Interested": "not-interested",
    "Out of Office": "out-of-office",
    "Automated Reply": "automated-reply",
    "Follow Up": "follow-up",
    "Information Requested": "follow-up",
    "Interested": "interested",
    Blacklist: "not-interested",
    Positive: "interested", // Legacy - maps to same as "Interested"
    Neutral: "new",
  };
  return mapping[sentimentTag || ""] || "new";
}

/**
 * Tags that can require action when the latest message is inbound.
 */
const ATTENTION_SENTIMENT_TAGS = [
  "Meeting Requested",
  "Call Requested",
  "Information Requested",
  "Positive", // Legacy - treat as Interested
  "Interested",
  "Follow Up",
] as const;

function isAttentionSentimentTag(sentimentTag: string | null): boolean {
  return ATTENTION_SENTIMENT_TAGS.includes((sentimentTag || "") as (typeof ATTENTION_SENTIMENT_TAGS)[number]);
}

function leadRequiresAttention(lead: {
  status: string;
  sentimentTag: string | null;
  lastMessageDirection?: string | null;
}): boolean {
  if (lead.status === "blacklisted") return false;
  if (lead.sentimentTag === "Blacklist") return false;
  if (!isAttentionSentimentTag(lead.sentimentTag)) return false;
  return lead.lastMessageDirection === "inbound";
}

/**
 * Detect the primary channel from the latest message
 */
function detectPrimaryChannel(
  latestMessage: { channel?: string | null; emailBisonReplyId?: string | null; subject?: string | null; rawHtml?: string | null } | undefined,
  lead: { senderAccountId?: string | null }
): Channel {
  // Use explicit channel field if present
  if (latestMessage?.channel) {
    return latestMessage.channel as Channel;
  }
  // Fall back to heuristic detection for legacy messages
  if (latestMessage?.emailBisonReplyId || latestMessage?.subject || latestMessage?.rawHtml) {
    return "email";
  }
  if (lead.senderAccountId) {
    return "email";
  }
  return "sms";
}

/**
 * Get unique channels from messages
 */
function getChannelsFromMessages(messages: { channel?: string | null }[]): Channel[] {
  const channelSet = new Set<Channel>();
  for (const msg of messages) {
    if (msg.channel) {
      channelSet.add(msg.channel as Channel);
    } else {
      // Legacy messages without channel field default to "sms"
      channelSet.add("sms");
    }
  }
  return Array.from(channelSet);
}

/**
 * Fetch all conversations (leads with messages) for the inbox
 * @param clientId - Optional client ID to filter by workspace
 */
export async function getConversations(clientId?: string | null): Promise<{
  success: boolean;
  data?: ConversationData[];
  error?: string;
}> {
  try {
    const now = new Date();
    const snoozeFilter = { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] };
    const scope = await resolveClientScope(clientId);
    if (scope.clientIds.length === 0) return { success: true, data: [] };

    const leads = await prisma.lead.findMany({
      where: { clientId: { in: scope.clientIds }, ...snoozeFilter },
      include: {
        client: {
          select: {
            id: true,
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
        messages: {
          orderBy: { sentAt: "desc" },
          select: {
            id: true,
            body: true,
            subject: true,
            channel: true,
            direction: true,
            emailBisonReplyId: true,
            rawHtml: true,
            sentAt: true,
          },
        },
        aiDrafts: {
          where: { status: "pending" },
          take: 1,
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    const conversations: ConversationData[] = leads.map((lead) => {
      const latestMessage = lead.messages[0];
      const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
      const primaryChannel = detectPrimaryChannel(latestMessage, lead);
      const channels = getChannelsFromMessages(lead.messages);
      const availableChannels = getAvailableChannels({
        phone: lead.phone,
        email: lead.email,
        linkedinUrl: lead.linkedinUrl,
        linkedinId: lead.linkedinId,
      });
      const campaignId = primaryChannel === "email" ? lead.emailCampaignId ?? lead.campaignId : lead.campaignId;
      const channelDrafts = lead.aiDrafts.filter(
        (draft) => draft.channel === primaryChannel || (!draft.channel && primaryChannel === "sms")
      );

      return {
        id: lead.id,
        lead: {
          id: lead.id,
          name: fullName,
          email: lead.email,
          phone: lead.phone,
          company: lead.client.name,
          title: "", // Not stored in current schema
          status: lead.status,
          autoReplyEnabled: lead.autoReplyEnabled,
          autoFollowUpEnabled: lead.autoFollowUpEnabled,
          autoBookMeetingsEnabled: lead.autoBookMeetingsEnabled,
          smsDndActive: lead.smsDndActive,
          clientId: lead.clientId,
          smsCampaignId: lead.smsCampaignId,
          smsCampaignName: lead.smsCampaign?.name ?? null,
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
        },
        channels,
        availableChannels,
        primaryChannel,
        classification: mapSentimentToClassification(lead.sentimentTag),
        lastMessage: latestMessage?.body || "No messages yet",
        lastSubject: latestMessage?.subject || null,
        lastMessageTime: latestMessage?.sentAt || lead.createdAt, // Use sentAt for actual message time
        // Hide drafts for blacklisted leads
        hasAiDraft: lead.status !== "blacklisted" && lead.sentimentTag !== "Blacklist" && channelDrafts.length > 0,
        requiresAttention: leadRequiresAttention(lead),
        sentimentTag: lead.sentimentTag,
        campaignId,
        emailCampaignId: lead.emailCampaignId,
      };
    });

    return { success: true, data: conversations };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to fetch conversations:", errorMessage, error);
    return {
      success: false,
      error: `Failed to fetch conversations: ${errorMessage}`
    };
  }
}

/**
 * Get inbox filter counts for sidebar
 * @param clientId - Optional client ID to filter by workspace
 */
export async function getInboxCounts(clientId?: string | null): Promise<{
  allResponses: number;
  requiresAttention: number;
  previouslyRequiredAttention: number;
  awaitingReply: number;
  needsRepair: number;
  total: number;
}> {
  try {
    const scope = await resolveClientScope(clientId);
    if (scope.clientIds.length === 0) {
      return {
        allResponses: 0,
        requiresAttention: 0,
        previouslyRequiredAttention: 0,
        awaitingReply: 0,
        needsRepair: 0,
        total: 0,
      };
    }
    const now = new Date();
    const snoozeFilter = { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] };
    const positiveSentimentTags = [
      "Meeting Requested",
      "Call Requested",
      "Information Requested",
      "Interested",
      "Positive", // Legacy - treat as Interested
    ];
    const clientFilter = { clientId: { in: scope.clientIds } };

    const [allResponses, attention, previousAttention, total, blacklisted, needsRepair] = await Promise.all([
      // All inbound replies (latest message is inbound)
      prisma.lead.count({
        where: {
          ...clientFilter,
          ...snoozeFilter,
          lastInboundAt: { not: null },
          lastMessageDirection: "inbound",
        },
      }),
      // Count leads requiring attention (excluding blacklisted)
      prisma.lead.count({
        where: {
          ...clientFilter,
          ...snoozeFilter,
          sentimentTag: { in: ATTENTION_SENTIMENT_TAGS as unknown as string[] },
          lastMessageDirection: "inbound",
          status: { not: "blacklisted" },
        },
      }),
      // Leads that previously required attention (positive + had inbound history + latest message is outbound)
      prisma.lead.count({
        where: {
          ...clientFilter,
          ...snoozeFilter,
          sentimentTag: { in: positiveSentimentTags },
          lastInboundAt: { not: null },
          lastMessageDirection: "outbound",
          status: { not: "blacklisted" },
        },
      }),
      // Total leads (excluding blacklisted)
      prisma.lead.count({
        where: {
          ...clientFilter,
          ...snoozeFilter,
          status: { not: "blacklisted" },
        },
      }),
      // Count blacklisted separately for debugging
      prisma.lead.count({
        where: {
          ...clientFilter,
          ...snoozeFilter,
          status: "blacklisted",
        },
      }),
      // Count leads that need repair (failed EmailBison lead creation)
      prisma.lead.count({
        where: {
          ...clientFilter,
          ...snoozeFilter,
          status: "needs_repair",
        },
      }),
    ]);

    return {
      allResponses,
      requiresAttention: attention,
      previouslyRequiredAttention: previousAttention,
      awaitingReply: Math.max(0, total - attention),
      needsRepair,
      total: total + blacklisted, // Include blacklisted in total for reference
    };
  } catch (error) {
    console.error("Failed to get inbox counts:", error);
    return {
      allResponses: 0,
      requiresAttention: 0,
      previouslyRequiredAttention: 0,
      awaitingReply: 0,
      needsRepair: 0,
      total: 0,
    };
  }
}

/**
 * Get a single conversation with full message history
 */
export async function getConversation(leadId: string, channelFilter?: Channel) {
  try {
    const user = await requireAuthUser();
    const accessible = await getAccessibleClientIdsForUser(user.id);
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        client: {
          select: {
            id: true,
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
        messages: {
          where: channelFilter ? { channel: channelFilter } : undefined,
          orderBy: { sentAt: "asc" }, // Order by actual message time
        },
      },
    });

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }
    if (!accessible.includes(lead.clientId)) {
      return { success: false, error: "Unauthorized" };
    }

    const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
    const latestMessage = lead.messages[lead.messages.length - 1];
    const primaryChannel = detectPrimaryChannel(latestMessage, lead);
    const channels = getChannelsFromMessages(lead.messages);
    const availableChannels = getAvailableChannels({
      phone: lead.phone,
      email: lead.email,
      linkedinUrl: lead.linkedinUrl,
      linkedinId: lead.linkedinId,
    });

    return {
      success: true,
      data: {
        id: lead.id,
        lead: {
          id: lead.id,
          name: fullName,
          email: lead.email,
          phone: lead.phone,
          company: lead.client.name,
          title: "",
          status: lead.status,
          sentimentTag: lead.sentimentTag,
          autoReplyEnabled: lead.autoReplyEnabled,
          autoFollowUpEnabled: lead.autoFollowUpEnabled,
          autoBookMeetingsEnabled: lead.autoBookMeetingsEnabled,
          smsDndActive: lead.smsDndActive,
          clientId: lead.clientId,
          smsCampaignId: lead.smsCampaignId,
          smsCampaignName: lead.smsCampaign?.name ?? null,
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
        },
        channels,
        availableChannels,
        primaryChannel,
        messages: lead.messages.map((msg) => ({
          id: msg.id,
          sender: msg.direction === "inbound" ? ("lead" as const) : ("ai" as const),
          content: msg.body,
          subject: msg.subject || undefined,
          rawHtml: msg.rawHtml || undefined,
          rawText: msg.rawText || undefined,
          cc: msg.cc,
          bcc: msg.bcc,
          channel: (msg.channel || "sms") as Channel,
          direction: msg.direction as "inbound" | "outbound",
          timestamp: msg.sentAt, // Use sentAt for actual message time
        })),
      },
    };
  } catch (error) {
    console.error("Failed to fetch conversation:", error);
    return { success: false, error: "Failed to fetch conversation" };
  }
}

/**
 * Get a lead's workspace (client) ID
 * Used for URL validation and auto-switching workspaces
 */
export async function getLeadWorkspaceId(leadId: string): Promise<{
  success: boolean;
  workspaceId?: string;
  error?: string;
}> {
  try {
    const user = await requireAuthUser();
    const accessible = await getAccessibleClientIdsForUser(user.id);
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { clientId: true },
    });

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }
    if (!accessible.includes(lead.clientId)) {
      return { success: false, error: "Unauthorized" };
    }

    return { success: true, workspaceId: lead.clientId };
  } catch (error) {
    console.error("Failed to get lead workspace:", error);
    return { success: false, error: "Failed to get lead workspace" };
  }
}

// =============================================================================
// Cursor-Based Pagination for Conversations (Performance Optimized)
// =============================================================================

export interface ConversationsCursorOptions {
  clientId?: string | null;
  cursor?: string | null; // Lead ID to start after
  limit?: number;
  search?: string;
  channels?: Channel[];
  channel?: Channel | "all";
  sentimentTag?: string;
  sentimentTags?: string[];
  smsCampaignId?: string;
  smsCampaignUnattributed?: boolean;
  filter?: "responses" | "attention" | "needs_repair" | "previous_attention" | "drafts" | "all";
}

export interface ConversationsCursorResult {
  success: boolean;
  conversations: ConversationData[];
  nextCursor: string | null;
  hasMore: boolean;
  error?: string;
}

/**
 * Transform a lead to ConversationData format
 */
function transformLeadToConversation(lead: any): ConversationData {
  const latestMessage = lead.messages[0];
  const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
  const primaryChannel = detectPrimaryChannel(latestMessage, lead);
  const channels = getChannelsFromMessages(lead.messages);
  const availableChannels = getAvailableChannels({
    phone: lead.phone,
    email: lead.email,
    linkedinUrl: lead.linkedinUrl,
    linkedinId: lead.linkedinId,
  });
  const campaignId = primaryChannel === "email" ? lead.emailCampaignId ?? lead.campaignId : lead.campaignId;
  const channelDrafts = lead.aiDrafts?.filter(
    (draft: any) => draft.channel === primaryChannel || (!draft.channel && primaryChannel === "sms")
  ) || [];

  return {
    id: lead.id,
    lead: {
      id: lead.id,
      name: fullName,
      email: lead.email,
      phone: lead.phone,
      company: lead.client.name,
      title: "",
      status: lead.status,
      autoReplyEnabled: lead.autoReplyEnabled,
      autoFollowUpEnabled: lead.autoFollowUpEnabled,
      autoBookMeetingsEnabled: lead.autoBookMeetingsEnabled,
      smsDndActive: lead.smsDndActive,
      clientId: lead.clientId,
      smsCampaignId: lead.smsCampaignId,
      smsCampaignName: lead.smsCampaign?.name ?? null,
      linkedinUrl: lead.linkedinUrl,
      companyName: lead.companyName,
      companyWebsite: lead.companyWebsite,
      companyState: lead.companyState,
      emailBisonLeadId: lead.emailBisonLeadId,
      enrichmentStatus: lead.enrichmentStatus,
      ghlContactId: lead.ghlContactId,
      ghlLocationId: lead.client.ghlLocationId,
    },
    channels,
    availableChannels,
    primaryChannel,
    classification: mapSentimentToClassification(lead.sentimentTag),
    lastMessage: latestMessage?.body || "No messages yet",
    lastSubject: latestMessage?.subject || null,
    lastMessageTime: latestMessage?.sentAt || lead.createdAt,
    hasAiDraft: lead.status !== "blacklisted" && lead.sentimentTag !== "Blacklist" && channelDrafts.length > 0,
    requiresAttention: leadRequiresAttention(lead),
    sentimentTag: lead.sentimentTag,
    campaignId,
    emailCampaignId: lead.emailCampaignId,
  };
}

/**
 * Get conversations with cursor-based pagination
 * Optimized for large datasets (50,000+ leads)
 */
export async function getConversationsCursor(
  options: ConversationsCursorOptions
): Promise<ConversationsCursorResult> {
  try {
    const {
      clientId,
      cursor,
      limit = 50,
      search,
      channels,
      channel,
      sentimentTag,
      sentimentTags,
      smsCampaignId,
      smsCampaignUnattributed,
      filter,
    } = options;

    const scope = await resolveClientScope(clientId);
    if (scope.clientIds.length === 0) {
      return { success: true, conversations: [], nextCursor: null, hasMore: false };
    }

    // Build the where clause for filtering
    const whereConditions: any[] = [];
    const now = new Date();
    whereConditions.push({ OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] });

    whereConditions.push({ clientId: { in: scope.clientIds } });

    // Search filter
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

    // Channel filter - filter by messages having any selected channel
    const channelList =
      channels && channels.length > 0
        ? Array.from(new Set(channels))
        : channel && channel !== "all"
          ? [channel]
          : [];

    if (channelList.length > 0) {
      whereConditions.push({
        messages: {
          some: { channel: { in: channelList } },
        },
      });
    }

    // Sentiment tag filter (multi-select supported)
    if (sentimentTags && sentimentTags.length > 0) {
      whereConditions.push({ sentimentTag: { in: sentimentTags } });
    } else if (sentimentTag && sentimentTag !== "all") {
      whereConditions.push({ sentimentTag });
    }

    // SMS sub-client filter (Lead.smsCampaignId)
    if (smsCampaignUnattributed) {
      whereConditions.push({ smsCampaignId: null });
    } else if (smsCampaignId) {
      whereConditions.push({ smsCampaignId });
    }

    // Special filter presets
    if (filter === "responses") {
      whereConditions.push({
        lastInboundAt: { not: null },
        lastMessageDirection: "inbound",
      });
    } else if (filter === "attention") {
      whereConditions.push({
        sentimentTag: { in: ATTENTION_SENTIMENT_TAGS as unknown as string[] },
        lastMessageDirection: "inbound",
        status: { not: "blacklisted" },
      });
    } else if (filter === "previous_attention" || filter === "drafts") {
      whereConditions.push({
        sentimentTag: { in: ["Meeting Requested", "Call Requested", "Information Requested", "Interested", "Positive"] },
        lastInboundAt: { not: null },
        lastMessageDirection: "outbound",
        status: { not: "blacklisted" },
      });
    } else if (filter === "needs_repair") {
      whereConditions.push({ status: "needs_repair" });
    }

    const where = whereConditions.length > 0
      ? { AND: whereConditions }
      : undefined;

    // Build query with cursor pagination
    const queryOptions: any = {
      where,
      take: limit + 1,
      orderBy: { updatedAt: "desc" },
      include: {
        client: {
          select: {
            id: true,
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
        messages: {
          orderBy: { sentAt: "desc" },
          take: 1, // Only get latest message for list view
          select: {
            id: true,
            body: true,
            subject: true,
            channel: true,
            direction: true,
            emailBisonReplyId: true,
            rawHtml: true,
            sentAt: true,
          },
        },
        aiDrafts: {
          where: { status: "pending" },
          take: 1,
          select: {
            id: true,
            channel: true,
          },
        },
      },
    };

    // Add cursor if provided
    if (cursor) {
      queryOptions.cursor = { id: cursor };
      queryOptions.skip = 1;
    }

    const leads = await prisma.lead.findMany(queryOptions);

    // Check if there are more records
    const hasMore = leads.length > limit;
    const resultLeads = hasMore ? leads.slice(0, -1) : leads;
    const nextCursor = hasMore && resultLeads.length > 0
      ? resultLeads[resultLeads.length - 1].id
      : null;

    // Transform to conversation format
    const conversations = resultLeads.map(transformLeadToConversation);

    return {
      success: true,
      conversations,
      nextCursor,
      hasMore,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to fetch conversations with cursor:", errorMessage, error);
    return {
      success: false,
      conversations: [],
      nextCursor: null,
      hasMore: false,
      error: `Failed to fetch conversations: ${errorMessage}`,
    };
  }
}

/**
 * Get conversations from the end of the list (for "Jump to Bottom" feature)
 */
export async function getConversationsFromEnd(
  options: Omit<ConversationsCursorOptions, "cursor">
): Promise<ConversationsCursorResult> {
  try {
    const {
      clientId,
      limit = 50,
      search,
      channels,
      channel,
      sentimentTag,
      sentimentTags,
      smsCampaignId,
      smsCampaignUnattributed,
      filter,
    } = options;

    const scope = await resolveClientScope(clientId);
    if (scope.clientIds.length === 0) {
      return { success: true, conversations: [], nextCursor: null, hasMore: false };
    }

    // Build the where clause (same as cursor version)
    const whereConditions: any[] = [];
    const now = new Date();
    whereConditions.push({ OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] });

    whereConditions.push({ clientId: { in: scope.clientIds } });

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

    const channelList =
      channels && channels.length > 0
        ? Array.from(new Set(channels))
        : channel && channel !== "all"
          ? [channel]
          : [];

    if (channelList.length > 0) {
      whereConditions.push({
        messages: {
          some: { channel: { in: channelList } },
        },
      });
    }

    if (sentimentTags && sentimentTags.length > 0) {
      whereConditions.push({ sentimentTag: { in: sentimentTags } });
    } else if (sentimentTag && sentimentTag !== "all") {
      whereConditions.push({ sentimentTag });
    }

    if (smsCampaignUnattributed) {
      whereConditions.push({ smsCampaignId: null });
    } else if (smsCampaignId) {
      whereConditions.push({ smsCampaignId });
    }

    if (filter === "responses") {
      whereConditions.push({
        lastInboundAt: { not: null },
        lastMessageDirection: "inbound",
      });
    } else if (filter === "attention") {
      whereConditions.push({
        sentimentTag: { in: ATTENTION_SENTIMENT_TAGS as unknown as string[] },
        lastMessageDirection: "inbound",
        status: { not: "blacklisted" },
      });
    } else if (filter === "previous_attention" || filter === "drafts") {
      whereConditions.push({
        sentimentTag: { in: ["Meeting Requested", "Call Requested", "Information Requested", "Interested", "Positive"] },
        lastInboundAt: { not: null },
        lastMessageDirection: "outbound",
        status: { not: "blacklisted" },
      });
    } else if (filter === "needs_repair") {
      whereConditions.push({ status: "needs_repair" });
    }

    const where = whereConditions.length > 0
      ? { AND: whereConditions }
      : undefined;

    // Fetch from the "end" by reversing sort order
    const leads = await prisma.lead.findMany({
      where,
      take: limit,
      orderBy: { updatedAt: "asc" }, // Reverse order
      include: {
        client: {
          select: {
            id: true,
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
        messages: {
          orderBy: { sentAt: "desc" },
          take: 1,
          select: {
            id: true,
            body: true,
            subject: true,
            channel: true,
            direction: true,
            emailBisonReplyId: true,
            rawHtml: true,
            sentAt: true,
          },
        },
        aiDrafts: {
          where: { status: "pending" },
          take: 1,
          select: {
            id: true,
            channel: true,
          },
        },
      },
    });

    // Reverse to get correct display order
    const reversedLeads = leads.reverse();

    // Transform to conversation format
    const conversations = reversedLeads.map(transformLeadToConversation);

    const nextCursor = reversedLeads.length > 0 ? reversedLeads[0].id : null;

    return {
      success: true,
      conversations,
      nextCursor,
      hasMore: leads.length === limit,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to fetch conversations from end:", errorMessage, error);
    return {
      success: false,
      conversations: [],
      nextCursor: null,
      hasMore: false,
      error: `Failed to fetch conversations: ${errorMessage}`,
    };
  }
}

// =============================================================================
// Diagnostic Functions for Debugging
// =============================================================================

/**
 * Diagnostic function to analyze sentiment tag distribution for a workspace
 * Helps debug issues with "requires attention" counts and filter functionality
 */
export async function diagnoseSentimentTags(clientId?: string | null): Promise<{
  success: boolean;
  data?: {
    totalLeads: number;
    sentimentDistribution: Record<string, number>;
    attentionTagsCount: number;
    blacklistedCount: number;
    leadsWithNullSentiment: number;
    sampleLeadsNeedingAttention: Array<{ id: string; name: string; sentimentTag: string | null; status: string }>;
  };
  error?: string;
}> {
  try {
    const scope = await resolveClientScope(clientId);
    if (scope.clientIds.length === 0) {
      return {
        success: true,
        data: {
          totalLeads: 0,
          sentimentDistribution: {},
          attentionTagsCount: 0,
          blacklistedCount: 0,
          leadsWithNullSentiment: 0,
          sampleLeadsNeedingAttention: [],
        },
      };
    }
    const clientFilter = { clientId: { in: scope.clientIds } };
    const attentionTags = [
      "Meeting Requested",
      "Call Requested",
      "Information Requested",
      "Positive",
      "Interested",
      "Follow Up"
    ];

    // Get all leads for the workspace
    const leads = await prisma.lead.findMany({
      where: clientFilter,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        sentimentTag: true,
        status: true,
      },
    });

    // Calculate sentiment distribution
    const sentimentDistribution: Record<string, number> = {};
    let leadsWithNullSentiment = 0;

    for (const lead of leads) {
      if (lead.sentimentTag === null) {
        leadsWithNullSentiment++;
        sentimentDistribution["(null)"] = (sentimentDistribution["(null)"] || 0) + 1;
      } else {
        sentimentDistribution[lead.sentimentTag] = (sentimentDistribution[lead.sentimentTag] || 0) + 1;
      }
    }

    // Count leads that should require attention
    const attentionLeads = leads.filter(
      (lead) => attentionTags.includes(lead.sentimentTag || "") && lead.status !== "blacklisted"
    );

    // Count blacklisted
    const blacklistedCount = leads.filter((lead) => lead.status === "blacklisted").length;

    // Get sample leads that require attention
    const sampleLeadsNeedingAttention = attentionLeads.slice(0, 5).map((lead) => ({
      id: lead.id,
      name: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown",
      sentimentTag: lead.sentimentTag,
      status: lead.status,
    }));

    return {
      success: true,
      data: {
        totalLeads: leads.length,
        sentimentDistribution,
        attentionTagsCount: attentionLeads.length,
        blacklistedCount,
        leadsWithNullSentiment,
        sampleLeadsNeedingAttention,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to diagnose sentiment tags:", errorMessage, error);
    return {
      success: false,
      error: `Failed to diagnose sentiment tags: ${errorMessage}`,
    };
  }
}
