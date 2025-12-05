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
  };
  platform: "email" | "sms" | "linkedin";
  classification: string;
  lastMessage: string;
  lastMessageTime: Date;
  hasAiDraft: boolean;
  requiresAttention: boolean;
  sentimentTag: string | null;
  campaignId: string | null;
}

/**
 * Map database sentiment tags to UI classification
 */
function mapSentimentToClassification(sentimentTag: string | null): string {
  const mapping: Record<string, string> = {
    "Meeting Requested": "meeting-requested",
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
          orderBy: { createdAt: "desc" },
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
        },
        platform: "sms" as const, // Currently only SMS is implemented
        classification: mapSentimentToClassification(lead.sentimentTag),
        lastMessage: latestMessage?.body || "No messages yet",
        lastMessageTime: latestMessage?.createdAt || lead.createdAt,
        hasAiDraft: lead.aiDrafts && lead.aiDrafts.length > 0,
        requiresAttention: requiresAttention(lead.sentimentTag),
        sentimentTag: lead.sentimentTag,
        campaignId: lead.campaignId,
      };
    });

    return { success: true, data: conversations };
  } catch (error) {
    console.error("Failed to fetch conversations:", error);
    return { success: false, error: "Failed to fetch conversations" };
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
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }

    const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";

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
        },
        messages: lead.messages.map((msg) => ({
          id: msg.id,
          sender: msg.direction === "inbound" ? ("lead" as const) : ("ai" as const),
          content: msg.body,
          timestamp: msg.createdAt,
        })),
      },
    };
  } catch (error) {
    console.error("Failed to fetch conversation:", error);
    return { success: false, error: "Failed to fetch conversation" };
  }
}

