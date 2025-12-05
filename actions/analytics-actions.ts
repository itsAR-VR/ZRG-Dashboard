"use server";

import { prisma } from "@/lib/prisma";

export interface AnalyticsData {
  overview: {
    totalLeads: number;
    responseRate: number;
    meetingsBooked: number;
    avgResponseTime: string;
  };
  sentimentBreakdown: {
    sentiment: string;
    count: number;
    percentage: number;
  }[];
  weeklyStats: {
    day: string;
    inbound: number;
    outbound: number;
  }[];
  leadsByStatus: {
    status: string;
    count: number;
    percentage: number;
  }[];
  topClients: {
    name: string;
    leads: number;
    meetings: number;
  }[];
}

/**
 * Calculate average response time from inbound messages to outbound responses
 * @param clientId - Optional workspace ID to filter by
 * @returns Formatted string like "2.4h" or "15m" or "N/A"
 */
async function calculateAvgResponseTime(clientId?: string | null): Promise<string> {
  try {
    // Get all leads with their messages ordered by actual message time
    const leads = await prisma.lead.findMany({
      where: clientId ? { clientId } : undefined,
      include: {
        messages: {
          orderBy: { sentAt: "asc" }, // Use sentAt for accurate timing
          select: {
            direction: true,
            sentAt: true,
          },
        },
      },
    });

    const responseTimes: number[] = [];

    // For each lead, find response times (inbound -> outbound pairs)
    for (const lead of leads) {
      const messages = lead.messages;

      for (let i = 0; i < messages.length - 1; i++) {
        const current = messages[i];
        const next = messages[i + 1];

        // Look for inbound message followed by outbound response
        if (current.direction === "inbound" && next.direction === "outbound") {
          const responseTimeMs = new Date(next.sentAt).getTime() - new Date(current.sentAt).getTime();
          // Only count responses within 7 days (ignore stale data)
          if (responseTimeMs > 0 && responseTimeMs < 7 * 24 * 60 * 60 * 1000) {
            responseTimes.push(responseTimeMs);
          }
        }
      }
    }

    if (responseTimes.length === 0) {
      return "N/A";
    }

    // Calculate average in milliseconds
    const avgMs = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;

    // Format the time
    const minutes = Math.round(avgMs / (1000 * 60));

    if (minutes < 60) {
      return `${minutes}m`;
    }

    const hours = avgMs / (1000 * 60 * 60);
    if (hours < 24) {
      return `${hours.toFixed(1)}h`;
    }

    const days = hours / 24;
    return `${days.toFixed(1)}d`;
  } catch (error) {
    console.error("Error calculating avg response time:", error);
    return "N/A";
  }
}

/**
 * Get analytics data from the database
 * @param clientId - Optional workspace ID to filter by
 */
export async function getAnalytics(clientId?: string | null): Promise<{
  success: boolean;
  data?: AnalyticsData;
  error?: string;
}> {
  try {
    const clientFilter = clientId ? { clientId } : {};

    // Get total leads
    const totalLeads = await prisma.lead.count({
      where: clientFilter,
    });

    // Get leads we contacted (have outbound messages)
    const leadsContacted = await prisma.lead.count({
      where: {
        ...clientFilter,
        messages: {
          some: {
            direction: "outbound",
          },
        },
      },
    });

    // Get leads that replied (have inbound messages)
    const leadsResponded = await prisma.lead.count({
      where: {
        ...clientFilter,
        messages: {
          some: {
            direction: "inbound",
          },
        },
      },
    });

    // Calculate response rate: leads that replied / leads contacted
    const responseRate = leadsContacted > 0
      ? Math.round((leadsResponded / leadsContacted) * 100)
      : 0;

    // Get meetings booked (leads with "Meeting Requested" sentiment)
    const meetingsBooked = await prisma.lead.count({
      where: {
        ...clientFilter,
        sentimentTag: "Meeting Requested",
      },
    });

    // Get sentiment breakdown
    const sentimentCounts = await prisma.lead.groupBy({
      by: ["sentimentTag"],
      where: clientFilter,
      _count: {
        sentimentTag: true,
      },
    });

    const sentimentBreakdown = sentimentCounts.map((s) => ({
      sentiment: s.sentimentTag || "Unknown",
      count: s._count.sentimentTag,
      percentage: totalLeads > 0
        ? Math.round((s._count.sentimentTag / totalLeads) * 100)
        : 0,
    }));

    // Get status breakdown
    const statusCounts = await prisma.lead.groupBy({
      by: ["status"],
      where: clientFilter,
      _count: {
        status: true,
      },
    });

    const leadsByStatus = statusCounts.map((s) => ({
      status: s.status,
      count: s._count.status,
      percentage: totalLeads > 0
        ? Math.round((s._count.status / totalLeads) * 100)
        : 0,
    }));

    // Get weekly message stats (last 7 days)
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); // 6 days ago + today = 7 days
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const messages = await prisma.message.findMany({
      where: {
        sentAt: { // Use sentAt for accurate message timing
          gte: sevenDaysAgo,
        },
      },
      select: {
        direction: true,
        sentAt: true,
      },
    });

    // Group messages by actual date (last 7 days)
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const weeklyStats: { day: string; inbound: number; outbound: number }[] = [];

    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const dayMessages = messages.filter((m) => {
        const msgDate = new Date(m.sentAt);
        return msgDate >= date && msgDate < nextDate;
      });

      weeklyStats.push({
        day: dayNames[date.getDay()],
        inbound: dayMessages.filter((m) => m.direction === "inbound").length,
        outbound: dayMessages.filter((m) => m.direction === "outbound").length,
      });
    }

    // Get top clients
    const clients = await prisma.client.findMany({
      include: {
        leads: {
          select: {
            id: true,
            sentimentTag: true,
          },
        },
      },
    });

    const topClients = clients
      .map((client) => ({
        name: client.name,
        leads: client.leads.length,
        meetings: client.leads.filter((l) => l.sentimentTag === "Meeting Requested").length,
      }))
      .sort((a, b) => b.leads - a.leads)
      .slice(0, 5);

    // Calculate actual average response time
    const avgResponseTime = await calculateAvgResponseTime(clientId);

    return {
      success: true,
      data: {
        overview: {
          totalLeads,
          responseRate,
          meetingsBooked,
          avgResponseTime,
        },
        sentimentBreakdown,
        weeklyStats,
        leadsByStatus,
        topClients,
      },
    };
  } catch (error) {
    console.error("Failed to fetch analytics:", error);
    return { success: false, error: "Failed to fetch analytics" };
  }
}

