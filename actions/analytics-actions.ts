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
 * Get analytics data from the database
 */
export async function getAnalytics(): Promise<{
  success: boolean;
  data?: AnalyticsData;
  error?: string;
}> {
  try {
    // Get total leads
    const totalLeads = await prisma.lead.count();

    // Get leads we contacted (have outbound messages)
    const leadsContacted = await prisma.lead.count({
      where: {
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
        sentimentTag: "Meeting Requested",
      },
    });

    // Get sentiment breakdown
    const sentimentCounts = await prisma.lead.groupBy({
      by: ["sentimentTag"],
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
        createdAt: {
          gte: sevenDaysAgo,
        },
      },
      select: {
        direction: true,
        createdAt: true,
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
        const msgDate = new Date(m.createdAt);
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

    return {
      success: true,
      data: {
        overview: {
          totalLeads,
          responseRate,
          meetingsBooked,
          avgResponseTime: "2.4h", // TODO: Calculate from actual message timestamps
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

