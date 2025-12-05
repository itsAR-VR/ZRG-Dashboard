import { prisma } from "@/lib/prisma";

export interface LeadWithMessages {
  id: string;
  ghlContactId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  sentimentTag: string | null;
  clientId: string;
  createdAt: Date;
  updatedAt: Date;
  client: {
    id: string;
    name: string;
  };
  messages: {
    id: string;
    body: string;
    direction: string;
    createdAt: Date;
  }[];
  _latestMessage?: {
    body: string;
    createdAt: Date;
    direction: string;
  };
}

/**
 * Get all leads with their latest message, ordered by most recent activity
 */
export async function getLeadsWithLatestMessage(clientId?: string) {
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
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  // Transform to include latest message at top level for easier access
  return leads.map((lead) => ({
    ...lead,
    _latestMessage: lead.messages[0] || null,
  }));
}

/**
 * Get a single lead with all messages
 */
export async function getLeadWithMessages(leadId: string) {
  return prisma.lead.findUnique({
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
}

/**
 * Get lead by GHL contact ID
 */
export async function getLeadByGhlContactId(ghlContactId: string) {
  return prisma.lead.findUnique({
    where: { ghlContactId },
    include: {
      client: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });
}

/**
 * Get leads filtered by sentiment tag
 */
export async function getLeadsBySentiment(sentimentTag: string, clientId?: string) {
  return prisma.lead.findMany({
    where: {
      sentimentTag,
      ...(clientId ? { clientId } : {}),
    },
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
    },
    orderBy: {
      updatedAt: "desc",
    },
  });
}

/**
 * Get leads that need attention (specific sentiment tags)
 */
export async function getLeadsRequiringAttention(clientId?: string) {
  const attentionTags = ["Meeting Requested", "Information Requested", "Follow Up"];

  return prisma.lead.findMany({
    where: {
      sentimentTag: { in: attentionTags },
      ...(clientId ? { clientId } : {}),
    },
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
    },
    orderBy: {
      updatedAt: "desc",
    },
  });
}

/**
 * Update lead sentiment tag
 */
export async function updateLeadSentiment(leadId: string, sentimentTag: string) {
  return prisma.lead.update({
    where: { id: leadId },
    data: { sentimentTag },
  });
}

/**
 * Get conversation statistics
 */
export async function getConversationStats(clientId?: string) {
  const whereClause = clientId ? { clientId } : {};

  const [total, byStatus, bySentiment] = await Promise.all([
    prisma.lead.count({ where: whereClause }),
    prisma.lead.groupBy({
      by: ["status"],
      where: whereClause,
      _count: true,
    }),
    prisma.lead.groupBy({
      by: ["sentimentTag"],
      where: whereClause,
      _count: true,
    }),
  ]);

  return {
    total,
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
    bySentiment: Object.fromEntries(
      bySentiment.map((s) => [s.sentimentTag || "Unknown", s._count])
    ),
  };
}

