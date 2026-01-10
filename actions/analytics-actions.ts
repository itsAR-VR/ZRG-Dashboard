"use server";

import { prisma } from "@/lib/prisma";
import { POSITIVE_SENTIMENTS } from "@/lib/sentiment-shared";
import { resolveClientScope } from "@/lib/workspace-access";
import type { MeetingBookingProvider } from "@prisma/client";

export interface AnalyticsData {
  overview: {
    totalLeads: number;
    outboundLeadsContacted: number;
    responses: number;
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
  smsSubClients: {
    name: string;
    leads: number;
    responses: number;
    meetingsBooked: number;
  }[];
}

/**
 * Calculate average response time from inbound messages to outbound responses
 * @param clientId - Optional workspace ID to filter by
 * @returns Formatted string like "2.4h" or "15m" or "N/A"
 */
async function calculateAvgResponseTime(clientId?: string | null): Promise<string> {
  try {
    const scope = await resolveClientScope(clientId);
    if (scope.clientIds.length === 0) return "N/A";
    // Get all leads with their messages ordered by actual message time
    const leads = await prisma.lead.findMany({
      where: { clientId: { in: scope.clientIds } },
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
    const scope = await resolveClientScope(clientId);
    if (scope.clientIds.length === 0) {
      return {
        success: true,
        data: {
          overview: {
            totalLeads: 0,
            outboundLeadsContacted: 0,
            responses: 0,
            responseRate: 0,
            meetingsBooked: 0,
            avgResponseTime: "N/A",
          },
          sentimentBreakdown: [],
          weeklyStats: [],
          leadsByStatus: [],
          topClients: [],
          smsSubClients: [],
        },
      };
    }

    const clientFilter = { clientId: { in: scope.clientIds } };

    // Get total leads
    const totalLeads = await prisma.lead.count({
      where: clientFilter,
    });

    // Outbound leads contacted (best-effort from DB only; outbound SMS from GHL automations isn't ingested yet)
    const outboundLeadsContacted = await prisma.lead.count({
      where: {
        ...clientFilter,
        messages: {
          some: {
            direction: "outbound",
          },
        },
      },
    });

    const respondedLeadFilter = {
      ...clientFilter,
      messages: {
        some: {
          direction: "inbound",
        },
      },
    };

    // Responses = unique leads with inbound messages
    const responses = await prisma.lead.count({
      where: respondedLeadFilter,
    });

    // Response rate = responses / outbound leads contacted
    const responseRate = outboundLeadsContacted > 0
      ? Math.round((responses / outboundLeadsContacted) * 100)
      : 0;

    // Meetings booked = leads with a booked appointment (created by our system)
    const meetingsBooked = await prisma.lead.count({
      where: {
        ...clientFilter,
        OR: [
          { appointmentBookedAt: { not: null } },
          { ghlAppointmentId: { not: null } },
          { calendlyInviteeUri: { not: null } },
          { calendlyScheduledEventUri: { not: null } },
        ],
      },
    });

    // Response sentiment breakdown (responded leads only)
    const sentimentCounts = await prisma.lead.groupBy({
      by: ["sentimentTag"],
      where: respondedLeadFilter,
      _count: {
        _all: true,
      },
    });

    const sentimentAgg = new Map<string, number>();
    for (const row of sentimentCounts) {
      const raw = row.sentimentTag;
      // "New" means "no inbound replies yet" and shouldn't show up in response sentiment.
      const sentiment = !raw || raw === "New" ? "Unknown" : raw;
      sentimentAgg.set(sentiment, (sentimentAgg.get(sentiment) ?? 0) + row._count._all);
    }

    const sentimentBreakdown = Array.from(sentimentAgg.entries()).map(([sentiment, count]) => ({
      sentiment,
      count,
      percentage: responses > 0 ? (count / responses) * 100 : 0,
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
        lead: { clientId: { in: scope.clientIds } },
        sentAt: {
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
      where: { id: { in: scope.clientIds } },
      include: {
        leads: {
          select: {
            id: true,
            ghlAppointmentId: true,
            calendlyInviteeUri: true,
            calendlyScheduledEventUri: true,
            appointmentBookedAt: true,
          },
        },
      },
    });

    const topClients = clients
      .map((client) => ({
        name: client.name,
        leads: client.leads.length,
        meetings: client.leads.filter(
          (l) =>
            l.appointmentBookedAt != null ||
            l.ghlAppointmentId != null ||
            l.calendlyInviteeUri != null ||
            l.calendlyScheduledEventUri != null
        ).length,
      }))
      .sort((a, b) => b.leads - a.leads)
      .slice(0, 5);

    // SMS sub-client breakdown inside a workspace (Lead.smsCampaignId)
    const smsSubClients: AnalyticsData["smsSubClients"] = [];
    if (clientId) {
      const positiveSentimentTags = [...POSITIVE_SENTIMENTS, "Positive"] as unknown as string[];

      const [campaigns, leadsBySmsCampaign, responsesBySmsCampaign, meetingsBySmsCampaign] = await Promise.all([
        prisma.smsCampaign.findMany({
          where: { clientId },
          select: { id: true, name: true },
        }),
        prisma.lead.groupBy({
          by: ["smsCampaignId"],
          where: {
            clientId,
            sentimentTag: { in: positiveSentimentTags },
          },
          _count: { _all: true },
        }),
        prisma.lead.groupBy({
          by: ["smsCampaignId"],
          where: {
            clientId,
            messages: { some: { direction: "inbound" } },
          },
          _count: { _all: true },
        }),
        prisma.lead.groupBy({
          by: ["smsCampaignId"],
          where: {
            clientId,
            OR: [
              { appointmentBookedAt: { not: null } },
              { ghlAppointmentId: { not: null } },
              { calendlyInviteeUri: { not: null } },
              { calendlyScheduledEventUri: { not: null } },
            ],
          },
          _count: { _all: true },
        }),
      ]);

      const nameById = new Map<string, string>(campaigns.map((c) => [c.id, c.name]));
      const leadsCountByKey = new Map<string, number>();
      const responsesCountByKey = new Map<string, number>();
      const meetingsCountByKey = new Map<string, number>();

      for (const row of leadsBySmsCampaign) {
        leadsCountByKey.set(row.smsCampaignId ?? "__unattributed__", row._count._all);
      }
      for (const row of responsesBySmsCampaign) {
        responsesCountByKey.set(row.smsCampaignId ?? "__unattributed__", row._count._all);
      }
      for (const row of meetingsBySmsCampaign) {
        meetingsCountByKey.set(row.smsCampaignId ?? "__unattributed__", row._count._all);
      }

      const keys = new Set<string>([
        ...leadsCountByKey.keys(),
        ...responsesCountByKey.keys(),
        ...meetingsCountByKey.keys(),
      ]);

      for (const key of keys) {
        const name =
          key === "__unattributed__"
            ? "Unattributed"
            : nameById.get(key) ?? "Unknown";

        smsSubClients.push({
          name,
          leads: leadsCountByKey.get(key) ?? 0,
          responses: responsesCountByKey.get(key) ?? 0,
          meetingsBooked: meetingsCountByKey.get(key) ?? 0,
        });
      }

      smsSubClients.sort((a, b) => b.leads - a.leads);
    }

    // Calculate actual average response time
    const avgResponseTime = await calculateAvgResponseTime(clientId);

    return {
      success: true,
      data: {
        overview: {
          totalLeads,
          outboundLeadsContacted,
          responses,
          responseRate,
          meetingsBooked,
          avgResponseTime,
        },
        sentimentBreakdown,
        weeklyStats,
        leadsByStatus,
        topClients,
        smsSubClients,
      },
    };
  } catch (error) {
    console.error("Failed to fetch analytics:", error);
    return { success: false, error: "Failed to fetch analytics" };
  }
}

const KPI_POSITIVE_REPLIES = POSITIVE_SENTIMENTS;
const KPI_MEETINGS_REQUESTED = ["Meeting Requested", "Call Requested"] as const;

type HeadcountBucket =
  | "1-10"
  | "11-50"
  | "51-200"
  | "201-500"
  | "501-1000"
  | "1000+"
  | "Unknown";

function parseHeadcount(value: string | null | undefined): number | null {
  const raw = (value || "").trim();
  if (!raw) return null;

  const cleaned = raw.replace(/,/g, "");

  const range = cleaned.match(/(\d+)\s*-\s*(\d+)/);
  if (range?.[2]) {
    const n = Number.parseInt(range[2], 10);
    return Number.isFinite(n) ? n : null;
  }

  const plus = cleaned.match(/(\d+)\s*\+/);
  if (plus?.[1]) {
    const n = Number.parseInt(plus[1], 10);
    return Number.isFinite(n) ? n : null;
  }

  const single = cleaned.match(/(\d+)/);
  if (single?.[1]) {
    const n = Number.parseInt(single[1], 10);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

function bucketHeadcount(value: string | null | undefined): HeadcountBucket {
  const n = parseHeadcount(value);
  if (!n || n <= 0) return "Unknown";
  if (n <= 10) return "1-10";
  if (n <= 50) return "11-50";
  if (n <= 200) return "51-200";
  if (n <= 500) return "201-500";
  if (n <= 1000) return "501-1000";
  return "1000+";
}

function safeRate(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return numerator / denominator;
}

export type EmailCampaignKpiRow = {
  id: string;
  bisonCampaignId: string;
  name: string;
  clientId: string;
  clientName: string;
  responseMode: string;
  autoSendConfidenceThreshold: number;
  provider: "GHL" | "CALENDLY";
  positiveReplies: number;
  meetingsRequested: number;
  meetingsBooked: number;
  rates: {
    bookedPerPositive: number;
    requestedPerPositive: number;
    bookedPerRequested: number;
  };
  byIndustry: Array<{
    industry: string;
    positiveReplies: number;
    meetingsBooked: number;
    bookingRate: number;
  }>;
  byHeadcountBucket: Array<{
    bucket: HeadcountBucket;
    positiveReplies: number;
    meetingsBooked: number;
    bookingRate: number;
  }>;
};

export type WeeklyEmailCampaignReport = {
  range: { from: string; to: string };
  topCampaignsByBookingRate: EmailCampaignKpiRow[];
  bottomCampaignsByBookingRate: EmailCampaignKpiRow[];
  highPositiveLowBooking: EmailCampaignKpiRow[];
  sentimentBreakdown: Array<{ sentiment: string; count: number }>;
  bookingRateByIndustry: Array<{ industry: string; positiveReplies: number; meetingsBooked: number; bookingRate: number }>;
  bookingRateByHeadcountBucket: Array<{ bucket: HeadcountBucket; positiveReplies: number; meetingsBooked: number; bookingRate: number }>;
};

export async function getEmailCampaignAnalytics(opts?: {
  clientId?: string | null;
  from?: string; // ISO
  to?: string; // ISO
}): Promise<{
  success: boolean;
  data?: { campaigns: EmailCampaignKpiRow[]; weeklyReport: WeeklyEmailCampaignReport };
  error?: string;
}> {
  try {
    const scope = await resolveClientScope(opts?.clientId ?? null);
    if (scope.clientIds.length === 0) {
      const now = new Date();
      const from = new Date(now);
      from.setDate(from.getDate() - 7);
      return {
        success: true,
        data: {
          campaigns: [],
          weeklyReport: {
            range: { from: from.toISOString(), to: now.toISOString() },
            topCampaignsByBookingRate: [],
            bottomCampaignsByBookingRate: [],
            highPositiveLowBooking: [],
            sentimentBreakdown: [],
            bookingRateByIndustry: [],
            bookingRateByHeadcountBucket: [],
          },
        },
      };
    }

    const now = new Date();
    const to = opts?.to ? new Date(opts.to) : now;
    const from = opts?.from ? new Date(opts.from) : new Date(new Date(to).setDate(to.getDate() - 7));

    const campaigns = await prisma.emailCampaign.findMany({
      where: { clientId: { in: scope.clientIds } },
      select: {
        id: true,
        bisonCampaignId: true,
        name: true,
        responseMode: true,
        autoSendConfidenceThreshold: true,
        clientId: true,
        client: {
          select: {
            name: true,
            settings: { select: { meetingBookingProvider: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    });

    const campaignIds = campaigns.map((c) => c.id);
    if (campaignIds.length === 0) {
      return {
        success: true,
        data: {
          campaigns: [],
          weeklyReport: {
            range: { from: from.toISOString(), to: to.toISOString() },
            topCampaignsByBookingRate: [],
            bottomCampaignsByBookingRate: [],
            highPositiveLowBooking: [],
            sentimentBreakdown: [],
            bookingRateByIndustry: [],
            bookingRateByHeadcountBucket: [],
          },
        },
      };
    }

    const clientProviderById = new Map<string, MeetingBookingProvider>(
      campaigns.map((c) => [c.clientId, c.client.settings?.meetingBookingProvider ?? "GHL"])
    );

    const leads = await prisma.lead.findMany({
      where: {
        clientId: { in: scope.clientIds },
        emailCampaignId: { in: campaignIds },
        OR: [
          { lastInboundAt: { gte: from, lt: to } },
          { appointmentBookedAt: { gte: from, lt: to } },
        ],
      },
      select: {
        id: true,
        clientId: true,
        emailCampaignId: true,
        sentimentTag: true,
        lastInboundAt: true,
        appointmentBookedAt: true,
        ghlAppointmentId: true,
        calendlyInviteeUri: true,
        calendlyScheduledEventUri: true,
        industry: true,
        employeeHeadcount: true,
      },
    });

    type BucketCounts = { positive: number; booked: number };

    const rowsByCampaignId = new Map<string, EmailCampaignKpiRow>();
    const industryAgg = new Map<string, BucketCounts>();
    const headcountAgg = new Map<HeadcountBucket, BucketCounts>();
    const sentimentAgg = new Map<string, number>();

    for (const c of campaigns) {
      const provider = clientProviderById.get(c.clientId) ?? "GHL";
      rowsByCampaignId.set(c.id, {
        id: c.id,
        bisonCampaignId: c.bisonCampaignId,
        name: c.name,
        clientId: c.clientId,
        clientName: c.client.name,
        responseMode: String(c.responseMode),
        autoSendConfidenceThreshold: c.autoSendConfidenceThreshold,
        provider,
        positiveReplies: 0,
        meetingsRequested: 0,
        meetingsBooked: 0,
        rates: { bookedPerPositive: 0, requestedPerPositive: 0, bookedPerRequested: 0 },
        byIndustry: [],
        byHeadcountBucket: [],
      });
    }

    const industryByCampaign = new Map<string, Map<string, BucketCounts>>();
    const headcountByCampaign = new Map<string, Map<HeadcountBucket, BucketCounts>>();

    const inRange = (d: Date | null) => !!d && d >= from && d < to;

    for (const lead of leads) {
      const campaignId = lead.emailCampaignId;
      if (!campaignId) continue;

      const row = rowsByCampaignId.get(campaignId);
      if (!row) continue;

      if (inRange(lead.lastInboundAt)) {
        const tag = lead.sentimentTag || "Unknown";
        sentimentAgg.set(tag, (sentimentAgg.get(tag) ?? 0) + 1);
      }

      const provider = row.provider;
      const bookedForProvider =
        provider === "CALENDLY"
          ? Boolean(lead.calendlyInviteeUri || lead.calendlyScheduledEventUri)
          : Boolean(lead.ghlAppointmentId);

      const isPositive = inRange(lead.lastInboundAt) && KPI_POSITIVE_REPLIES.includes(lead.sentimentTag as any);
      const isMeetingRequested = inRange(lead.lastInboundAt) && KPI_MEETINGS_REQUESTED.includes(lead.sentimentTag as any);
      const isBooked = inRange(lead.appointmentBookedAt) && bookedForProvider;

      if (isPositive) row.positiveReplies += 1;
      if (isMeetingRequested) row.meetingsRequested += 1;
      if (isBooked) row.meetingsBooked += 1;

      const industry = (lead.industry || "").trim() || "Unknown";
      const bucket = bucketHeadcount(lead.employeeHeadcount);

      if (isPositive) {
        const globalInd = industryAgg.get(industry) ?? { positive: 0, booked: 0 };
        globalInd.positive += 1;
        industryAgg.set(industry, globalInd);

        const globalHc = headcountAgg.get(bucket) ?? { positive: 0, booked: 0 };
        globalHc.positive += 1;
        headcountAgg.set(bucket, globalHc);

        const perCampaignInd = industryByCampaign.get(campaignId) ?? new Map<string, BucketCounts>();
        const indCounts = perCampaignInd.get(industry) ?? { positive: 0, booked: 0 };
        indCounts.positive += 1;
        perCampaignInd.set(industry, indCounts);
        industryByCampaign.set(campaignId, perCampaignInd);

        const perCampaignHc = headcountByCampaign.get(campaignId) ?? new Map<HeadcountBucket, BucketCounts>();
        const hcCounts = perCampaignHc.get(bucket) ?? { positive: 0, booked: 0 };
        hcCounts.positive += 1;
        perCampaignHc.set(bucket, hcCounts);
        headcountByCampaign.set(campaignId, perCampaignHc);
      }

      if (isBooked) {
        const globalInd = industryAgg.get(industry) ?? { positive: 0, booked: 0 };
        globalInd.booked += 1;
        industryAgg.set(industry, globalInd);

        const globalHc = headcountAgg.get(bucket) ?? { positive: 0, booked: 0 };
        globalHc.booked += 1;
        headcountAgg.set(bucket, globalHc);

        const perCampaignInd = industryByCampaign.get(campaignId) ?? new Map<string, BucketCounts>();
        const indCounts = perCampaignInd.get(industry) ?? { positive: 0, booked: 0 };
        indCounts.booked += 1;
        perCampaignInd.set(industry, indCounts);
        industryByCampaign.set(campaignId, perCampaignInd);

        const perCampaignHc = headcountByCampaign.get(campaignId) ?? new Map<HeadcountBucket, BucketCounts>();
        const hcCounts = perCampaignHc.get(bucket) ?? { positive: 0, booked: 0 };
        hcCounts.booked += 1;
        perCampaignHc.set(bucket, hcCounts);
        headcountByCampaign.set(campaignId, perCampaignHc);
      }
    }

    const campaignsOut = Array.from(rowsByCampaignId.values()).map((row) => {
      row.rates.bookedPerPositive = safeRate(row.meetingsBooked, row.positiveReplies);
      row.rates.requestedPerPositive = safeRate(row.meetingsRequested, row.positiveReplies);
      row.rates.bookedPerRequested = safeRate(row.meetingsBooked, row.meetingsRequested);

      const ind = industryByCampaign.get(row.id) ?? new Map<string, BucketCounts>();
      row.byIndustry = Array.from(ind.entries())
        .map(([industry, counts]) => ({
          industry,
          positiveReplies: counts.positive,
          meetingsBooked: counts.booked,
          bookingRate: safeRate(counts.booked, counts.positive),
        }))
        .sort((a, b) => b.bookingRate - a.bookingRate);

      const hc = headcountByCampaign.get(row.id) ?? new Map<HeadcountBucket, BucketCounts>();
      row.byHeadcountBucket = Array.from(hc.entries())
        .map(([bucket, counts]) => ({
          bucket,
          positiveReplies: counts.positive,
          meetingsBooked: counts.booked,
          bookingRate: safeRate(counts.booked, counts.positive),
        }))
        .sort((a, b) => b.bookingRate - a.bookingRate);

      return row;
    });

    const sortedByBookingRate = [...campaignsOut].sort((a, b) => b.rates.bookedPerPositive - a.rates.bookedPerPositive);
    const top = sortedByBookingRate.slice(0, 5);
    const bottom = sortedByBookingRate.slice(Math.max(0, sortedByBookingRate.length - 5)).reverse();

    const highPositiveLowBooking = campaignsOut
      .filter((c) => c.positiveReplies >= 8 && c.rates.bookedPerPositive <= 0.1)
      .sort((a, b) => b.positiveReplies - a.positiveReplies);

    const sentimentBreakdown = Array.from(sentimentAgg.entries())
      .map(([sentiment, count]) => ({ sentiment, count }))
      .sort((a, b) => b.count - a.count);

    const bookingRateByIndustry = Array.from(industryAgg.entries())
      .map(([industry, counts]) => ({
        industry,
        positiveReplies: counts.positive,
        meetingsBooked: counts.booked,
        bookingRate: safeRate(counts.booked, counts.positive),
      }))
      .sort((a, b) => b.bookingRate - a.bookingRate);

    const bookingRateByHeadcountBucket = Array.from(headcountAgg.entries())
      .map(([bucket, counts]) => ({
        bucket,
        positiveReplies: counts.positive,
        meetingsBooked: counts.booked,
        bookingRate: safeRate(counts.booked, counts.positive),
      }))
      .sort((a, b) => b.bookingRate - a.bookingRate);

    return {
      success: true,
      data: {
        campaigns: campaignsOut,
        weeklyReport: {
          range: { from: from.toISOString(), to: to.toISOString() },
          topCampaignsByBookingRate: top,
          bottomCampaignsByBookingRate: bottom,
          highPositiveLowBooking,
          sentimentBreakdown,
          bookingRateByIndustry,
          bookingRateByHeadcountBucket,
        },
      },
    };
  } catch (error) {
    console.error("[getEmailCampaignAnalytics] Failed:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to fetch email campaign analytics" };
  }
}
