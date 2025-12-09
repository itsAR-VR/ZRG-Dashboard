"use server";

import { prisma } from "@/lib/prisma";
import { getAvailableChannels } from "@/lib/lead-matching";

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
    clientId: string;  // For follow-up sequence management
    // Enrichment data
    linkedinUrl: string | null;
    companyName: string | null;
    companyWebsite: string | null;
    companyState: string | null;
    emailBisonLeadId: string | null;
    enrichmentStatus: string | null;
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
    "Follow Up": "follow-up",
    "Information Requested": "follow-up",
    Blacklist: "not-interested",
    Positive: "new",
    Neutral: "new",
  };
  return mapping[sentimentTag || ""] || "new";
}

/**
 * Check if a conversation requires attention based on sentiment
 * Includes all positive response types that need user action
 */
function requiresAttention(sentimentTag: string | null): boolean {
  const attentionTags = [
    "Meeting Requested",
    "Call Requested",
    "Information Requested",
    "Positive",
    "Interested",
    "Follow Up"
  ];
  return attentionTags.includes(sentimentTag || "");
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
    const leads = await prisma.lead.findMany({
      where: clientId ? { clientId } : undefined,
      include: {
        client: {
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
      const availableChannels = getAvailableChannels({ phone: lead.phone, email: lead.email });
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
          clientId: lead.clientId,
          // Enrichment data
          linkedinUrl: lead.linkedinUrl,
          companyName: lead.companyName,
          companyWebsite: lead.companyWebsite,
          companyState: lead.companyState,
          emailBisonLeadId: lead.emailBisonLeadId,
          enrichmentStatus: lead.enrichmentStatus,
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
        // Don't mark blacklisted leads as requiring attention
        requiresAttention: lead.status !== "blacklisted" && lead.sentimentTag !== "Blacklist" && requiresAttention(lead.sentimentTag),
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
  requiresAttention: number;
  draftsForApproval: number;
  awaitingReply: number;
  needsRepair: number;
  total: number;
}> {
  try {
    // Must match the attentionTags in requiresAttention function
    const attentionTags = [
      "Meeting Requested",
      "Call Requested",
      "Information Requested",
      "Positive",
      "Interested",
      "Follow Up"
    ];
    const clientFilter = clientId ? { clientId } : {};

    const [attention, drafts, total, blacklisted, needsRepair] = await Promise.all([
      // Count leads requiring attention (excluding blacklisted)
      prisma.lead.count({
        where: {
          ...clientFilter,
          sentimentTag: { in: attentionTags },
          status: { not: "blacklisted" },
        },
      }),
      // Exclude drafts for blacklisted leads
      prisma.aIDraft.count({
        where: {
          status: "pending",
          lead: {
            ...(clientId ? { clientId } : {}),
            sentimentTag: { not: "Blacklist" },
            status: { not: "blacklisted" },
          },
        },
      }),
      // Total leads (excluding blacklisted)
      prisma.lead.count({
        where: {
          ...clientFilter,
          status: { not: "blacklisted" },
        },
      }),
      // Count blacklisted separately for debugging
      prisma.lead.count({
        where: {
          ...clientFilter,
          status: "blacklisted",
        },
      }),
      // Count leads that need repair (failed EmailBison lead creation)
      prisma.lead.count({
        where: {
          ...clientFilter,
          status: "needs_repair",
        },
      }),
    ]);

    return {
      requiresAttention: attention,
      draftsForApproval: drafts,
      awaitingReply: Math.max(0, total - attention),
      needsRepair,
      total: total + blacklisted, // Include blacklisted in total for reference
    };
  } catch (error) {
    console.error("Failed to get inbox counts:", error);
    return {
      requiresAttention: 0,
      draftsForApproval: 0,
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
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        client: {
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

    const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
    const latestMessage = lead.messages[lead.messages.length - 1];
    const primaryChannel = detectPrimaryChannel(latestMessage, lead);
    const channels = getChannelsFromMessages(lead.messages);
    const availableChannels = getAvailableChannels({ phone: lead.phone, email: lead.email });

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
          clientId: lead.clientId,
          // Enrichment data
          linkedinUrl: lead.linkedinUrl,
          companyName: lead.companyName,
          companyWebsite: lead.companyWebsite,
          companyState: lead.companyState,
          emailBisonLeadId: lead.emailBisonLeadId,
          enrichmentStatus: lead.enrichmentStatus,
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
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { clientId: true },
    });

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }

    return { success: true, workspaceId: lead.clientId };
  } catch (error) {
    console.error("Failed to get lead workspace:", error);
    return { success: false, error: "Failed to get lead workspace" };
  }
}
