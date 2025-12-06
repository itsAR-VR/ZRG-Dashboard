"use server";

import { prisma } from "@/lib/prisma";

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
  };
  platform: "email" | "sms" | "linkedin";
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
 */
function requiresAttention(sentimentTag: string | null): boolean {
  const attentionTags = ["Meeting Requested", "Information Requested", "Follow Up"];
  return attentionTags.includes(sentimentTag || "");
}

function detectPlatform(
  latestMessage: { emailBisonReplyId?: string | null; subject?: string | null; rawHtml?: string | null } | undefined,
  lead: { senderAccountId?: string | null }
): "email" | "sms" {
  if (latestMessage?.emailBisonReplyId || latestMessage?.subject || latestMessage?.rawHtml) {
    return "email";
  }
  if (lead.senderAccountId) {
    return "email";
  }
  return "sms";
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
          take: 1,
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
      const platform = detectPlatform(latestMessage, lead);
      const campaignId = platform === "email" ? lead.emailCampaignId ?? lead.campaignId : lead.campaignId;
      const channelDrafts = lead.aiDrafts.filter(
        (draft) => draft.channel === platform || (!draft.channel && platform === "sms")
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
        },
        platform,
        classification: mapSentimentToClassification(lead.sentimentTag),
        lastMessage: latestMessage?.body || "No messages yet",
        lastSubject: latestMessage?.subject || null,
        lastMessageTime: latestMessage?.sentAt || lead.createdAt, // Use sentAt for actual message time
        hasAiDraft: channelDrafts.length > 0,
        requiresAttention: requiresAttention(lead.sentimentTag),
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
  total: number;
}> {
  try {
    const attentionTags = ["Meeting Requested", "Information Requested", "Follow Up"];
    const clientFilter = clientId ? { clientId } : {};

    const [attention, drafts, total] = await Promise.all([
      prisma.lead.count({
        where: {
          ...clientFilter,
          sentimentTag: { in: attentionTags },
        },
      }),
      prisma.aIDraft.count({
        where: {
          status: "pending",
          lead: clientId ? { clientId } : undefined,
        },
      }),
      prisma.lead.count({
        where: clientFilter,
      }),
    ]);

    return {
      requiresAttention: attention,
      draftsForApproval: drafts,
      awaitingReply: Math.max(0, total - attention),
      total,
    };
  } catch (error) {
    console.error("Failed to get inbox counts:", error);
    return {
      requiresAttention: 0,
      draftsForApproval: 0,
      awaitingReply: 0,
      total: 0,
    };
  }
}

/**
 * Get a single conversation with full message history
 */
export async function getConversation(leadId: string) {
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
          orderBy: { sentAt: "asc" }, // Order by actual message time
        },
      },
    });

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }

    const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
    const latestMessage = lead.messages[lead.messages.length - 1];
    const platform = detectPlatform(latestMessage, lead);

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
        },
        platform,
        messages: lead.messages.map((msg) => ({
          id: msg.id,
          sender: msg.direction === "inbound" ? ("lead" as const) : ("ai" as const),
          content: msg.body,
          subject: msg.subject || undefined,
          rawHtml: msg.rawHtml || undefined,
          rawText: msg.rawText || undefined,
          cc: msg.cc,
          bcc: msg.bcc,
          channel: msg.emailBisonReplyId ? ("email" as const) : ("sms" as const),
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
