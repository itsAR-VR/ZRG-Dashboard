"use server";

import { prisma } from "@/lib/prisma";
import { POSITIVE_SENTIMENTS } from "@/lib/sentiment-shared";
import { requireAuthUser } from "@/lib/workspace-access";
import { formatDurationMs } from "@/lib/business-hours";
import { getSupabaseUserEmailsByIds } from "@/lib/supabase/admin";
import { accessibleClientWhere, accessibleLeadWhere } from "@/lib/workspace-access-filters";
import { Prisma, type ClientMemberRole, type MeetingBookingProvider } from "@prisma/client";

// Simple in-memory cache for analytics with TTL (5 minutes)
// Analytics data can be slightly stale without issues, and this dramatically reduces DB load
const ANALYTICS_CACHE_TTL_MS = 5 * 60 * 1000;
interface AnalyticsCacheEntry {
  data: AnalyticsData;
  expiresAt: number;
}
const analyticsCache = new Map<string, AnalyticsCacheEntry>();

// Cleanup stale entries periodically (every 10 minutes)
let lastCleanup = Date.now();
function maybeCleanupCache() {
  const now = Date.now();
  if (now - lastCleanup > 10 * 60 * 1000) {
    lastCleanup = now;
    for (const [key, entry] of analyticsCache) {
      if (entry.expiresAt < now) {
        analyticsCache.delete(key);
      }
    }
  }
}

/**
 * Invalidate analytics cache for a specific client or all clients.
 * Call this after significant data changes (e.g., new leads, messages, bookings).
 */
export async function invalidateAnalyticsCache(clientId?: string | null) {
  // Cache keys are user-scoped; safest invalidation is a full clear.
  // This is a small in-memory cache per serverless instance.
  analyticsCache.clear();

  // Optional: keep an escape hatch for future targeted invalidation.
  if (clientId) {
    void clientId;
  }
}

export interface ResponseTimeMetrics {
  setterResponseTime: {
    avgMs: number;
    formatted: string;
    sampleCount: number;
  };
  clientResponseTime: {
    avgMs: number;
    formatted: string;
    sampleCount: number;
  };
}

export interface SetterResponseTimeRow {
  userId: string;
  email: string | null;
  role: ClientMemberRole | null; // null if former member
  avgResponseTimeMs: number;
  avgResponseTimeFormatted: string;
  responseCount: number;
}

export interface AnalyticsData {
  overview: {
    totalLeads: number;
    outboundLeadsContacted: number;
    responses: number;
    responseRate: number;
    meetingsBooked: number;
    avgResponseTime: string; // Backward compatibility - same as setterResponseTime
    setterResponseTime: string;
    clientResponseTime: string;
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
  perSetterResponseTimes: SetterResponseTimeRow[];
}

function buildAccessibleLeadSqlWhere(opts: { userId: string; clientId?: string | null }): Prisma.Sql {
  if (opts.clientId) {
    return Prisma.sql`l."clientId" = ${opts.clientId}`;
  }

  return Prisma.sql`(
    EXISTS (SELECT 1 FROM "Client" c WHERE c.id = l."clientId" AND c."userId" = ${opts.userId})
    OR EXISTS (SELECT 1 FROM "ClientMember" cm WHERE cm."clientId" = l."clientId" AND cm."userId" = ${opts.userId})
  )`;
}

function sqlIsWithinEstBusinessHours(tsSql: Prisma.Sql): Prisma.Sql {
  // Weekdays (Mon-Fri) and hours 9:00-16:59 in America/New_York.
  return Prisma.sql`(
    EXTRACT(DOW FROM (${tsSql} AT TIME ZONE 'America/New_York')) BETWEEN 1 AND 5
    AND EXTRACT(HOUR FROM (${tsSql} AT TIME ZONE 'America/New_York')) >= 9
    AND EXTRACT(HOUR FROM (${tsSql} AT TIME ZONE 'America/New_York')) < 17
  )`;
}

/**
 * Calculate response time metrics with business hours filtering (9am-5pm EST, weekdays only).
 *
 * Separates two metrics:
 * - Setter Response Time: Time from client inbound message to our outbound response
 * - Client Response Time: Time from our outbound message to client inbound response
 *
 * Both metrics only count message pairs where BOTH timestamps are within business hours.
 * Messages are paired within the same channel to avoid cross-channel artifacts.
 *
 * @param clientId - Optional workspace ID to filter by
 * @returns ResponseTimeMetrics with setter and client response time data
 */
async function calculateResponseTimeMetricsSql(opts: { userId: string; clientId?: string | null }): Promise<ResponseTimeMetrics> {
  const defaultMetrics: ResponseTimeMetrics = {
    setterResponseTime: { avgMs: 0, formatted: "N/A", sampleCount: 0 },
    clientResponseTime: { avgMs: 0, formatted: "N/A", sampleCount: 0 },
  };

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const accessibleWhere = buildAccessibleLeadSqlWhere({ userId: opts.userId, clientId: opts.clientId });
    const bh1 = sqlIsWithinEstBusinessHours(Prisma.sql`sent_at`);
    const bh2 = sqlIsWithinEstBusinessHours(Prisma.sql`next_sent_at`);

    const rows = await prisma.$queryRaw<
      Array<{
        setter_avg_ms: number | null;
        setter_count: bigint;
        client_avg_ms: number | null;
        client_count: bigint;
      }>
    >`
      WITH ordered AS (
        SELECT
          m."sentAt" AS sent_at,
          m.direction AS direction,
          m.channel AS channel,
          LEAD(m."sentAt") OVER (PARTITION BY m."leadId", m.channel ORDER BY m."sentAt") AS next_sent_at,
          LEAD(m.direction) OVER (PARTITION BY m."leadId", m.channel ORDER BY m."sentAt") AS next_direction
        FROM "Message" m
        INNER JOIN "Lead" l ON l.id = m."leadId"
        WHERE m."sentAt" >= ${thirtyDaysAgo}
          AND ${accessibleWhere}
      )
      SELECT
        AVG(EXTRACT(EPOCH FROM (next_sent_at - sent_at)) * 1000)::double precision
          FILTER (
            WHERE
              next_sent_at IS NOT NULL
              AND next_sent_at > sent_at
              AND next_sent_at <= sent_at + INTERVAL '7 days'
              AND direction = 'inbound'
              AND next_direction = 'outbound'
              AND ${bh1}
              AND ${bh2}
          ) AS setter_avg_ms,
        COUNT(*) FILTER (
          WHERE
            next_sent_at IS NOT NULL
            AND next_sent_at > sent_at
            AND next_sent_at <= sent_at + INTERVAL '7 days'
            AND direction = 'inbound'
            AND next_direction = 'outbound'
            AND ${bh1}
            AND ${bh2}
        )::bigint AS setter_count,
        AVG(EXTRACT(EPOCH FROM (next_sent_at - sent_at)) * 1000)::double precision
          FILTER (
            WHERE
              next_sent_at IS NOT NULL
              AND next_sent_at > sent_at
              AND next_sent_at <= sent_at + INTERVAL '7 days'
              AND direction = 'outbound'
              AND next_direction = 'inbound'
              AND ${bh1}
              AND ${bh2}
          ) AS client_avg_ms,
        COUNT(*) FILTER (
          WHERE
            next_sent_at IS NOT NULL
            AND next_sent_at > sent_at
            AND next_sent_at <= sent_at + INTERVAL '7 days'
            AND direction = 'outbound'
            AND next_direction = 'inbound'
            AND ${bh1}
            AND ${bh2}
        )::bigint AS client_count
      FROM ordered
    `;

    const row = rows[0];
    if (!row) return defaultMetrics;

    const setterAvgMs = typeof row.setter_avg_ms === "number" && Number.isFinite(row.setter_avg_ms) ? row.setter_avg_ms : null;
    const clientAvgMs = typeof row.client_avg_ms === "number" && Number.isFinite(row.client_avg_ms) ? row.client_avg_ms : null;

    return {
      setterResponseTime: {
        avgMs: setterAvgMs ?? 0,
        formatted: setterAvgMs != null ? formatDurationMs(setterAvgMs) : "N/A",
        sampleCount: row.setter_count == null ? 0 : Number(row.setter_count),
      },
      clientResponseTime: {
        avgMs: clientAvgMs ?? 0,
        formatted: clientAvgMs != null ? formatDurationMs(clientAvgMs) : "N/A",
        sampleCount: row.client_count == null ? 0 : Number(row.client_count),
      },
    };
  } catch (error) {
    // Recoverable: returns default metrics. Log at warn level to avoid false-positive alerts.
    console.warn("Error calculating response time metrics:", error);
    return defaultMetrics;
  }
}

/**
 * Calculate per-setter response times (how fast each setter responds to client messages).
 * Only counts setter-sent messages (sentByUserId not null) with business hours filtering.
 *
 * @param clientId - Required workspace ID to filter by (per-setter only makes sense per workspace)
 * @returns Array of SetterResponseTimeRow sorted by response count (most active first)
 */
async function calculatePerSetterResponseTimesSql(opts: { userId: string; clientId: string }): Promise<SetterResponseTimeRow[]> {
  try {
    // Ensure caller has access to the workspace (server-side guard; avoids cross-user cache poisoning).
    const canAccess = await prisma.client.findFirst({
      where: { id: opts.clientId, ...accessibleClientWhere(opts.userId) },
      select: { id: true },
    });
    if (!canAccess) return [];

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const bh1 = sqlIsWithinEstBusinessHours(Prisma.sql`sent_at`);
    const bh2 = sqlIsWithinEstBusinessHours(Prisma.sql`next_sent_at`);

    const rawRows = await prisma.$queryRaw<
      Array<{
        user_id: string;
        avg_ms: number;
        response_count: bigint;
      }>
    >`
      WITH ordered AS (
        SELECT
          m."sentAt" AS sent_at,
          m.direction AS direction,
          m.channel AS channel,
          LEAD(m."sentAt") OVER (PARTITION BY m."leadId", m.channel ORDER BY m."sentAt") AS next_sent_at,
          LEAD(m.direction) OVER (PARTITION BY m."leadId", m.channel ORDER BY m."sentAt") AS next_direction,
          LEAD(m."sentByUserId") OVER (PARTITION BY m."leadId", m.channel ORDER BY m."sentAt") AS next_sent_by_user_id
        FROM "Message" m
        INNER JOIN "Lead" l ON l.id = m."leadId"
        WHERE m."sentAt" >= ${thirtyDaysAgo}
          AND l."clientId" = ${opts.clientId}
      )
      SELECT
        next_sent_by_user_id::text AS user_id,
        AVG(EXTRACT(EPOCH FROM (next_sent_at - sent_at)) * 1000)::double precision AS avg_ms,
        COUNT(*)::bigint AS response_count
      FROM ordered
      WHERE
        next_sent_at IS NOT NULL
        AND next_sent_at > sent_at
        AND next_sent_at <= sent_at + INTERVAL '7 days'
        AND direction = 'inbound'
        AND next_direction = 'outbound'
        AND next_sent_by_user_id IS NOT NULL
        AND ${bh1}
        AND ${bh2}
      GROUP BY next_sent_by_user_id
      ORDER BY response_count DESC
    `;

    if (rawRows.length === 0) return [];

    const userIds = rawRows.map((r) => r.user_id).filter(Boolean);
    const members = await prisma.clientMember.findMany({
      where: {
        clientId: opts.clientId,
        userId: { in: userIds },
      },
      select: {
        userId: true,
        role: true,
      },
    });

    const memberByUserId = new Map(members.map((m) => [m.userId, m]));

    // Batch fetch emails for all unique userIds (single operation instead of N+1 queries)
    const emailByUserId = await getSupabaseUserEmailsByIds(userIds);

    // Build result rows
    const resultRows: SetterResponseTimeRow[] = [];
    for (const row of rawRows) {
      const avgMs = Number(row.avg_ms);
      const count = row.response_count == null ? 0 : Number(row.response_count);
      if (!Number.isFinite(avgMs) || count <= 0) continue;

      const member = memberByUserId.get(row.user_id);
      resultRows.push({
        userId: row.user_id,
        email: emailByUserId.get(row.user_id) ?? null,
        role: member?.role ?? null,
        avgResponseTimeMs: avgMs,
        avgResponseTimeFormatted: formatDurationMs(avgMs),
        responseCount: count,
      });
    }

    return resultRows;
  } catch (error) {
    console.error("Error calculating per-setter response times:", error);
    return [];
  }
}

/**
 * Get analytics data from the database
 * @param clientId - Optional workspace ID to filter by
 * @param opts - Options for fetching analytics
 * @param opts.forceRefresh - Skip cache and fetch fresh data
 */
export async function getAnalytics(
  clientId?: string | null,
  opts?: { forceRefresh?: boolean }
): Promise<{
  success: boolean;
  data?: AnalyticsData;
  error?: string;
}> {
  try {
    const user = await requireAuthUser();

    // Enforce authorization (and avoid cache leakage) before serving any cached data.
    if (clientId) {
      const canAccess = await prisma.client.findFirst({
        where: { id: clientId, ...accessibleClientWhere(user.id) },
        select: { id: true },
      });
      if (!canAccess) {
        return { success: false, error: "Unauthorized" };
      }
    }

    // Cleanup stale cache entries periodically
    maybeCleanupCache();

    // Cache is user-scoped to avoid cross-user data leakage.
    const cacheKey = `${user.id}:${clientId || "__all__"}`;
    const now = Date.now();

    if (!opts?.forceRefresh) {
      const cached = analyticsCache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        return { success: true, data: cached.data };
      }
    }

    const leadWhere = clientId ? { clientId } : accessibleLeadWhere(user.id);

    // If global scope yields no accessible leads, return zeros.
    const anyAccessibleLead = await prisma.lead.findFirst({
      where: leadWhere,
      select: { id: true },
    });
    if (!anyAccessibleLead) {
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
            setterResponseTime: "N/A",
            clientResponseTime: "N/A",
          },
          sentimentBreakdown: [],
          weeklyStats: [],
          leadsByStatus: [],
          topClients: [],
          smsSubClients: [],
          perSetterResponseTimes: [],
        },
      };
    }

    // Get total leads
    const totalLeads = await prisma.lead.count({
      where: leadWhere,
    });

    // Outbound leads contacted (best-effort from DB only; outbound SMS from GHL automations isn't ingested yet)
    const outboundLeadsContacted = await prisma.lead.count({
      where: {
        ...leadWhere,
        messages: {
          some: {
            direction: "outbound",
          },
        },
      },
    });

    const respondedLeadFilter = {
      ...leadWhere,
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
        ...leadWhere,
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
      where: leadWhere,
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

    // Get weekly message stats (last 7 days) - using SQL GROUP BY for efficiency
    const currentDate = new Date();
    const sevenDaysAgo = new Date(currentDate);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); // 6 days ago + today = 7 days
    sevenDaysAgo.setHours(0, 0, 0, 0);

    // Use raw SQL to group by date in the database instead of fetching all messages
    const weeklyMessageStats = await prisma.$queryRaw<
      Array<{ day_date: Date; direction: string; count: bigint }>
    >`
      SELECT
        DATE_TRUNC('day', m."sentAt") as day_date,
        m.direction,
        COUNT(*) as count
      FROM "Message" m
      INNER JOIN "Lead" l ON m."leadId" = l.id
      WHERE ${buildAccessibleLeadSqlWhere({ userId: user.id, clientId })}
        AND m."sentAt" >= ${sevenDaysAgo}
      GROUP BY DATE_TRUNC('day', m."sentAt"), m.direction
      ORDER BY day_date ASC
    `;

    // Build a lookup map for quick access
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const statsMap = new Map<string, { inbound: number; outbound: number }>();

    for (const row of weeklyMessageStats) {
      const dateKey = new Date(row.day_date).toISOString().split('T')[0];
      if (!statsMap.has(dateKey)) {
        statsMap.set(dateKey, { inbound: 0, outbound: 0 });
      }
      const entry = statsMap.get(dateKey)!;
      if (row.direction === "inbound") {
        entry.inbound = Number(row.count);
      } else if (row.direction === "outbound") {
        entry.outbound = Number(row.count);
      }
    }

    // Build the weeklyStats array for the last 7 days
    const weeklyStats: { day: string; inbound: number; outbound: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(currentDate);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const dateKey = date.toISOString().split('T')[0];
      const stats = statsMap.get(dateKey) || { inbound: 0, outbound: 0 };

      weeklyStats.push({
        day: dayNames[date.getDay()],
        inbound: stats.inbound,
        outbound: stats.outbound,
      });
    }

    // Get top clients - use _count instead of loading all leads for efficiency
    const [leadCountsByClient, meetingCountsByClient] = await Promise.all([
      prisma.lead.groupBy({
        by: ["clientId"],
        where: leadWhere,
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 5,
      }),
      prisma.lead.groupBy({
        by: ["clientId"],
        where: {
          ...leadWhere,
          OR: [
            { appointmentBookedAt: { not: null } },
            { ghlAppointmentId: { not: null } },
            { calendlyInviteeUri: { not: null } },
            { calendlyScheduledEventUri: { not: null } },
          ],
        },
        _count: { id: true },
      }),
    ]);

    const topClientIds = leadCountsByClient.map((r) => r.clientId);
    const clients = topClientIds.length
      ? await prisma.client.findMany({
          where: { id: { in: topClientIds } },
          select: { id: true, name: true },
        })
      : [];

    const clientNameById = new Map(clients.map((c) => [c.id, c.name]));
    const meetingCountByClient = new Map(meetingCountsByClient.map((r) => [r.clientId, r._count.id]));

    const topClients = leadCountsByClient.map((row) => ({
      name: clientNameById.get(row.clientId) ?? "Unknown",
      leads: row._count.id,
      meetings: meetingCountByClient.get(row.clientId) ?? 0,
    }));

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

    // Calculate response time metrics (setter and client, business hours only)
    const responseTimeMetrics = await calculateResponseTimeMetricsSql({ userId: user.id, clientId });

    // Calculate per-setter response times (only when a specific workspace is selected)
    const perSetterResponseTimes = clientId
      ? await calculatePerSetterResponseTimesSql({ userId: user.id, clientId })
      : [];

    const analyticsData: AnalyticsData = {
      overview: {
        totalLeads,
        outboundLeadsContacted,
        responses,
        responseRate,
        meetingsBooked,
        avgResponseTime: responseTimeMetrics.setterResponseTime.formatted, // Backward compatibility
        setterResponseTime: responseTimeMetrics.setterResponseTime.formatted,
        clientResponseTime: responseTimeMetrics.clientResponseTime.formatted,
      },
      sentimentBreakdown,
      weeklyStats,
      leadsByStatus,
      topClients,
      smsSubClients,
      perSetterResponseTimes,
    };

    // Store in cache for future requests
    analyticsCache.set(cacheKey, {
      data: analyticsData,
      expiresAt: Date.now() + ANALYTICS_CACHE_TTL_MS,
    });

    return { success: true, data: analyticsData };
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
    const user = await requireAuthUser();

    const now = new Date();
    const to = opts?.to ? new Date(opts.to) : now;
    const from = opts?.from ? new Date(opts.from) : new Date(new Date(to).setDate(to.getDate() - 7));

    if (opts?.clientId) {
      const canAccess = await prisma.client.findFirst({
        where: { id: opts.clientId, ...accessibleClientWhere(user.id) },
        select: { id: true },
      });
      if (!canAccess) return { success: false, error: "Unauthorized" };
    }

    const campaigns = await prisma.emailCampaign.findMany({
      where: {
        ...(opts?.clientId ? { clientId: opts.clientId } : {}),
        client: accessibleClientWhere(user.id),
      },
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
        ...accessibleLeadWhere(user.id),
        ...(opts?.clientId ? { clientId: opts.clientId } : {}),
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

// ============================================================================
// Phase 43: Per-Setter Funnel Analytics
// ============================================================================

export interface SetterFunnelStats {
  userId: string;
  email: string;
  // Volume metrics
  assignedLeadsCount: number;
  respondedLeadsCount: number; // Leads with at least one outbound message from this setter
  // Conversion funnel
  positiveLeadsCount: number; // Leads with positive sentiment
  meetingsRequestedCount: number; // "Meeting Requested" or "Call Requested"
  meetingsBookedCount: number; // Has appointmentBookedAt or ghlAppointmentId
  // Rates (0-1)
  responseRate: number; // respondedLeadsCount / assignedLeadsCount
  positiveRate: number; // positiveLeadsCount / assignedLeadsCount
  meetingRequestRate: number; // meetingsRequestedCount / assignedLeadsCount
  bookingRate: number; // meetingsBookedCount / assignedLeadsCount
  requestToBookRate: number; // meetingsBookedCount / meetingsRequestedCount
}

/**
 * Get per-setter funnel analytics for a workspace.
 *
 * Tracks each setter's full conversion funnel:
 * Assigned → Responded → Positive → Meeting Requested → Meeting Booked
 */
export async function getSetterFunnelAnalytics(
  clientId: string
): Promise<{ success: true; data: SetterFunnelStats[] } | { success: false; error: string }> {
  try {
    const user = await requireAuthUser();
    const canAccess = await prisma.client.findFirst({
      where: { id: clientId, ...accessibleClientWhere(user.id) },
      select: { id: true },
    });
    if (!canAccess) {
      return { success: false, error: "Unauthorized" };
    }

    // Get all setters for this workspace
    const setters = await prisma.clientMember.findMany({
      where: { clientId, role: "SETTER" },
      select: { userId: true },
    });

    if (setters.length === 0) {
      return { success: true, data: [] };
    }

    // Fetch emails from Supabase auth
    const setterIds = setters.map((s) => s.userId);
    const emailMap = await getSupabaseUserEmailsByIds(setterIds);

    const results: SetterFunnelStats[] = [];

    // Positive sentiment tags (reuse from sentiment-shared)
    const positiveSentiments = [...POSITIVE_SENTIMENTS] as string[];

    for (const setter of setters) {
      // Get assigned leads with aggregated stats
      const assignedLeads = await prisma.lead.findMany({
        where: {
          clientId,
          assignedToUserId: setter.userId,
        },
        select: {
          id: true,
          sentimentTag: true,
          appointmentBookedAt: true,
          ghlAppointmentId: true,
          _count: {
            select: {
              messages: {
                where: {
                  direction: "outbound",
                  sentByUserId: setter.userId, // Only count messages sent BY this setter
                },
              },
            },
          },
        },
      });

      const assignedCount = assignedLeads.length;

      // Responded = leads with at least one outbound message from this setter
      const respondedCount = assignedLeads.filter((l) => l._count.messages > 0).length;

      // Positive sentiment
      const positiveCount = assignedLeads.filter(
        (l) => l.sentimentTag && positiveSentiments.includes(l.sentimentTag)
      ).length;

      // Meeting requested
      const meetingRequestedCount = assignedLeads.filter(
        (l) => l.sentimentTag === "Meeting Requested" || l.sentimentTag === "Call Requested"
      ).length;

      // Booked (either ZRG booking or GHL appointment)
      const bookedCount = assignedLeads.filter(
        (l) => l.appointmentBookedAt !== null || l.ghlAppointmentId !== null
      ).length;

      // Calculate rates (avoid division by zero)
      const safeDiv = (num: number, denom: number) => (denom > 0 ? num / denom : 0);

      results.push({
        userId: setter.userId,
        email: emailMap.get(setter.userId) ?? "Unknown",
        assignedLeadsCount: assignedCount,
        respondedLeadsCount: respondedCount,
        positiveLeadsCount: positiveCount,
        meetingsRequestedCount: meetingRequestedCount,
        meetingsBookedCount: bookedCount,
        responseRate: safeDiv(respondedCount, assignedCount),
        positiveRate: safeDiv(positiveCount, assignedCount),
        meetingRequestRate: safeDiv(meetingRequestedCount, assignedCount),
        bookingRate: safeDiv(bookedCount, assignedCount),
        requestToBookRate: safeDiv(bookedCount, meetingRequestedCount),
      });
    }

    // Sort by assigned count descending (most active setters first)
    results.sort((a, b) => b.assignedLeadsCount - a.assignedLeadsCount);

    return { success: true, data: results };
  } catch (error) {
    console.error("[getSetterFunnelAnalytics] Failed:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to fetch setter analytics" };
  }
}
