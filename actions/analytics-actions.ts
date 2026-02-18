"use server";

import { prisma } from "@/lib/prisma";
import {
  deriveCrmResponseMode,
  deriveCrmResponseType,
  mapLeadStatusFromSheet,
  mapSentimentTagFromSheet,
  normalizeCrmValue,
  type CrmResponseType,
} from "@/lib/crm-sheet-utils";
import { POSITIVE_SENTIMENTS } from "@/lib/sentiment-shared";
import { normalizeEmail, normalizePhone } from "@/lib/lead-matching";
import { normalizeLinkedInUrl } from "@/lib/linkedin-utils";
import { isSamePhone, toStoredPhone } from "@/lib/phone-utils";
import { getAccessibleClientIdsForUser, requireAuthUser } from "@/lib/workspace-access";
import { formatDurationMs } from "@/lib/business-hours";
import { redisGetJson, redisSetJson } from "@/lib/redis";
import { getSupabaseUserEmailsByIds } from "@/lib/supabase/admin";
import { requireWorkspaceCapabilities } from "@/lib/workspace-capabilities";
import { getWorkspaceCapacityUtilization, type CapacityUtilization } from "@/lib/calendar-capacity-metrics";
import { Prisma, type ClientMemberRole, type MeetingBookingProvider, type CrmResponseMode } from "@prisma/client";

// Simple in-memory cache for analytics with TTL (5 minutes)
// Analytics data can be slightly stale without issues, and this dramatically reduces DB load
const ANALYTICS_CACHE_TTL_MS = 5 * 60 * 1000;
const ANALYTICS_VERSION_KEY_PREFIX = "analytics:v1:ver:";
interface AnalyticsCacheEntry {
  data: AnalyticsData;
  expiresAt: number;
}

type AnalyticsAuthUser = {
  id: string;
  email: string | null;
};

async function resolveAnalyticsClientScope(
  user: AnalyticsAuthUser,
  clientId?: string | null
): Promise<{ clientIds: string[]; clientId: string | null } | null> {
  const accessibleClientIds = await getAccessibleClientIdsForUser(user.id, user.email);
  const normalizedClientId = (clientId || "").trim() || null;
  if (normalizedClientId) {
    if (!accessibleClientIds.includes(normalizedClientId)) return null;
    return { clientIds: [normalizedClientId], clientId: normalizedClientId };
  }
  return { clientIds: accessibleClientIds, clientId: null };
}

export interface SequenceAttributionRow {
  sequenceId: string;
  sequenceName: string;
  bookedCount: number;
  percentage: number;
}

export interface WorkflowAttributionData {
  window: { from: string; to: string };
  totalBooked: number;
  bookedFromInitial: number;
  bookedFromWorkflow: number;
  unattributed: number;
  initialRate: number;
  workflowRate: number;
  bySequence: SequenceAttributionRow[];
}

export async function getWorkflowAttributionAnalytics(opts?: {
  clientId?: string | null;
  from?: string;
  to?: string;
  authUser?: AnalyticsAuthUser;
}): Promise<{ success: boolean; data?: WorkflowAttributionData; error?: string }> {
  try {
    const user = opts?.authUser ?? (await requireAuthUser());
    const now = new Date();
    const windowState = resolveAnalyticsWindow({ from: opts?.from, to: opts?.to });
    const to = windowState.to ?? now;
    const from =
      windowState.from ?? new Date(to.getTime() - DEFAULT_ANALYTICS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const scope = await resolveAnalyticsClientScope(user, opts?.clientId ?? null);
    if (!scope) return { success: false, error: "Unauthorized" };

    const accessibleWhere = buildAccessibleLeadSqlWhere({
      userId: user.id,
      clientId: scope.clientId,
      clientIds: scope.clientIds,
    });

    const { totalsRows, sequenceRows } = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = 10000`;

      const totalsRows = await tx.$queryRaw<
        Array<{ total_booked: bigint; workflow_booked: bigint }>
      >`
        WITH booked AS (
          SELECT l.id AS lead_id, l."appointmentBookedAt" AS booked_at
          FROM "Lead" l
          WHERE l."appointmentBookedAt" >= ${from}
            AND l."appointmentBookedAt" < ${to}
            AND ${accessibleWhere}
        ),
        matched AS (
          SELECT
            b.lead_id,
            fi."sequenceId" AS sequence_id,
            fi."lastStepAt" AS last_step_at,
            ROW_NUMBER() OVER (PARTITION BY b.lead_id ORDER BY fi."lastStepAt" ASC) AS rn
          FROM booked b
          JOIN "FollowUpInstance" fi ON fi."leadId" = b.lead_id
          WHERE fi."lastStepAt" IS NOT NULL
            AND fi."lastStepAt" < b.booked_at
        ),
        workflow AS (
          SELECT lead_id, sequence_id
          FROM matched
          WHERE rn = 1
        )
        SELECT
          (SELECT COUNT(*) FROM booked) AS total_booked,
          (SELECT COUNT(*) FROM workflow) AS workflow_booked
      `;

      const sequenceRows = await tx.$queryRaw<
        Array<{ sequence_id: string; booked_count: bigint }>
      >`
        WITH booked AS (
          SELECT l.id AS lead_id, l."appointmentBookedAt" AS booked_at
          FROM "Lead" l
          WHERE l."appointmentBookedAt" >= ${from}
            AND l."appointmentBookedAt" < ${to}
            AND ${accessibleWhere}
        ),
        matched AS (
          SELECT
            b.lead_id,
            fi."sequenceId" AS sequence_id,
            fi."lastStepAt" AS last_step_at,
            ROW_NUMBER() OVER (PARTITION BY b.lead_id ORDER BY fi."lastStepAt" ASC) AS rn
          FROM booked b
          JOIN "FollowUpInstance" fi ON fi."leadId" = b.lead_id
          WHERE fi."lastStepAt" IS NOT NULL
            AND fi."lastStepAt" < b.booked_at
        ),
        workflow AS (
          SELECT lead_id, sequence_id
          FROM matched
          WHERE rn = 1
        )
        SELECT
          sequence_id,
          COUNT(*)::bigint AS booked_count
        FROM workflow
        GROUP BY sequence_id
        ORDER BY booked_count DESC
      `;

      return { totalsRows, sequenceRows };
    });

    const totalBooked = totalsRows?.[0]?.total_booked ? Number(totalsRows[0].total_booked) : 0;
    const bookedFromWorkflow = totalsRows?.[0]?.workflow_booked ? Number(totalsRows[0].workflow_booked) : 0;
    const bookedFromInitial = Math.max(0, totalBooked - bookedFromWorkflow);
    const unattributed = Math.max(0, totalBooked - bookedFromInitial - bookedFromWorkflow);

    const sequenceIds = sequenceRows.map((row) => row.sequence_id);
    const sequences = sequenceIds.length
      ? await prisma.followUpSequence.findMany({
          where: { id: { in: sequenceIds } },
          select: { id: true, name: true },
        })
      : [];
    const sequenceNameById = new Map(sequences.map((s) => [s.id, s.name]));

    const bySequence: SequenceAttributionRow[] = sequenceRows.map((row) => {
      const bookedCount = Number(row.booked_count);
      return {
        sequenceId: row.sequence_id,
        sequenceName: sequenceNameById.get(row.sequence_id) ?? "Unknown",
        bookedCount,
        percentage: bookedFromWorkflow > 0 ? bookedCount / bookedFromWorkflow : 0,
      };
    });

    return {
      success: true,
      data: {
        window: { from: from.toISOString(), to: to.toISOString() },
        totalBooked,
        bookedFromInitial,
        bookedFromWorkflow,
        unattributed,
        initialRate: safeRate(bookedFromInitial, totalBooked),
        workflowRate: safeRate(bookedFromWorkflow, totalBooked),
        bySequence,
      },
    };
  } catch (error) {
    console.error("[Analytics] Failed to get workflow attribution:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "Not authenticated" || message === "Unauthorized") {
      return { success: false, error: message };
    }
    return { success: false, error: "Failed to fetch workflow attribution" };
  }
}

export interface ReactivationCampaignKpiRow {
  campaignId: string;
  campaignName: string;
  totalSent: number;
  responded: number;
  responseRate: number;
  meetingsBooked: number;
  bookingRate: number;
}

export interface ReactivationAnalyticsData {
  window: { from: string; to: string };
  campaigns: ReactivationCampaignKpiRow[];
  totals: {
    totalSent: number;
    responded: number;
    responseRate: number;
    meetingsBooked: number;
    bookingRate: number;
  };
}

export async function getReactivationCampaignAnalytics(opts?: {
  clientId?: string | null;
  from?: string;
  to?: string;
  authUser?: AnalyticsAuthUser;
}): Promise<{ success: boolean; data?: ReactivationAnalyticsData; error?: string }> {
  try {
    const user = opts?.authUser ?? (await requireAuthUser());
    const now = new Date();
    const windowState = resolveAnalyticsWindow({ from: opts?.from, to: opts?.to });
    const to = windowState.to ?? now;
    const from =
      windowState.from ?? new Date(to.getTime() - DEFAULT_ANALYTICS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const scope = await resolveAnalyticsClientScope(user, opts?.clientId ?? null);
    if (!scope) return { success: false, error: "Unauthorized" };

    const accessibleWhere = buildAccessibleLeadSqlWhere({
      userId: user.id,
      clientId: scope.clientId,
      clientIds: scope.clientIds,
    });

    const { rows } = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = 10000`;

      const rows = await tx.$queryRaw<
        Array<{
          campaign_id: string;
          total_sent: bigint;
          responded: bigint;
          meetings_booked: bigint;
        }>
      >`
        WITH sent AS (
          SELECT
            re.id AS enrollment_id,
            re."campaignId" AS campaign_id,
            re."leadId" AS lead_id,
            re."sentAt" AS sent_at
          FROM "ReactivationEnrollment" re
          INNER JOIN "ReactivationCampaign" rc ON rc.id = re."campaignId"
          INNER JOIN "Lead" l ON l.id = re."leadId"
          WHERE re.status = 'sent'
            AND re."sentAt" >= ${from}
            AND re."sentAt" < ${to}
            AND ${accessibleWhere}
        ),
        responses AS (
          SELECT DISTINCT s.enrollment_id
          FROM sent s
          INNER JOIN "Message" m ON m."leadId" = s.lead_id
          WHERE m.direction = 'inbound'
            AND m."sentAt" > s.sent_at
            AND m."sentAt" < ${to}
        ),
        bookings AS (
          SELECT DISTINCT s.enrollment_id
          FROM sent s
          INNER JOIN "Lead" l ON l.id = s.lead_id
          WHERE l."appointmentBookedAt" IS NOT NULL
            AND l."appointmentBookedAt" > s.sent_at
            AND l."appointmentBookedAt" < ${to}
        )
        SELECT
          s.campaign_id,
          COUNT(*)::bigint AS total_sent,
          COUNT(DISTINCT r.enrollment_id)::bigint AS responded,
          COUNT(DISTINCT b.enrollment_id)::bigint AS meetings_booked
        FROM sent s
        LEFT JOIN responses r ON r.enrollment_id = s.enrollment_id
        LEFT JOIN bookings b ON b.enrollment_id = s.enrollment_id
        GROUP BY s.campaign_id
        ORDER BY total_sent DESC
      `;

      return { rows };
    });

    const campaignIds = rows.map((row) => row.campaign_id);
    const campaigns = campaignIds.length
      ? await prisma.reactivationCampaign.findMany({
          where: { id: { in: campaignIds } },
          select: { id: true, name: true },
        })
      : [];
    const campaignNameById = new Map(campaigns.map((c) => [c.id, c.name]));

    const campaignRows: ReactivationCampaignKpiRow[] = rows.map((row) => {
      const totalSent = Number(row.total_sent);
      const responded = Number(row.responded);
      const meetingsBooked = Number(row.meetings_booked);
      return {
        campaignId: row.campaign_id,
        campaignName: campaignNameById.get(row.campaign_id) ?? "Unknown",
        totalSent,
        responded,
        responseRate: safeRate(responded, totalSent),
        meetingsBooked,
        bookingRate: safeRate(meetingsBooked, totalSent),
      };
    });

    const totals = campaignRows.reduce(
      (acc, row) => {
        acc.totalSent += row.totalSent;
        acc.responded += row.responded;
        acc.meetingsBooked += row.meetingsBooked;
        return acc;
      },
      { totalSent: 0, responded: 0, meetingsBooked: 0 }
    );

    return {
      success: true,
      data: {
        window: { from: from.toISOString(), to: to.toISOString() },
        campaigns: campaignRows,
        totals: {
          totalSent: totals.totalSent,
          responded: totals.responded,
          responseRate: safeRate(totals.responded, totals.totalSent),
          meetingsBooked: totals.meetingsBooked,
          bookingRate: safeRate(totals.meetingsBooked, totals.totalSent),
        },
      },
    };
  } catch (error) {
    console.error("[Analytics] Failed to get reactivation campaign analytics:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "Not authenticated" || message === "Unauthorized") {
      return { success: false, error: message };
    }
    return { success: false, error: "Failed to fetch reactivation analytics" };
  }
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

  const normalizedClientId = (clientId || "").trim();
  if (!normalizedClientId) return;

  const versionKey = `${ANALYTICS_VERSION_KEY_PREFIX}${normalizedClientId}`;
  const current = await redisGetJson<number | string>(versionKey);
  const parsed =
    typeof current === "number"
      ? current
      : typeof current === "string"
        ? Number.parseInt(current, 10)
        : Number.NaN;
  const nextVersion = Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) + 1 : 1;
  await redisSetJson(versionKey, nextVersion, { exSeconds: 30 * 24 * 60 * 60 });
}

export interface AnalyticsWindow {
  from?: string; // ISO string (inclusive)
  to?: string; // ISO string (exclusive)
}

const DEFAULT_ANALYTICS_WINDOW_DAYS = 30;

function resolveAnalyticsWindow(window?: AnalyticsWindow, fallbackDays = DEFAULT_ANALYTICS_WINDOW_DAYS): {
  from: Date | null;
  to: Date | null;
  key: string;
} {
  if (!window?.from && !window?.to) {
    return { from: null, to: null, key: "all" };
  }

  const now = new Date();
  const to = window?.to ? new Date(window.to) : now;
  const from = window?.from
    ? new Date(window.from)
    : new Date(to.getTime() - fallbackDays * 24 * 60 * 60 * 1000);

  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    return { from: null, to: null, key: "all" };
  }

  if (from > to) {
    return { from: to, to: from, key: `${to.toISOString()}_${from.toISOString()}` };
  }

  return { from, to, key: `${from.toISOString()}_${to.toISOString()}` };
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
    capacity?: CapacityUtilization;
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

export type AnalyticsOverviewParts = "all" | "core" | "breakdowns";

export interface CrmSheetRow {
  id: string;
  leadId: string;
  date: Date | null;
  campaign: string | null;
  companyName: string | null;
  website: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  leadEmail: string | null;
  leadLinkedIn: string | null;
  phoneNumber: string | null;
  stepResponded: number | null;
  leadCategory: string | null;
  responseType: CrmResponseType;
  leadStatus: string | null;
  channel: string | null;
  leadType: string | null;
  applicationStatus: string | null;
  appointmentSetter: string | null;
  setterAssignment: string | null;
  notes: string | null;
  initialResponseDate: Date | null;
  followUp1: Date | null;
  followUp2: Date | null;
  followUp3: Date | null;
  followUp4: Date | null;
  followUp5: Date | null;
  responseStepComplete: boolean | null;
  dateOfBooking: Date | null;
  dateOfMeeting: Date | null;
  qualified: boolean | null;
  followUpDateRequested: Date | null;
  setters: string | null;
  responseMode: CrmResponseMode | null;
  leadScore: number | null;
}

export interface CrmSheetFilters {
  campaign?: string | null;
  leadStatus?: string | null;
  leadCategory?: string | null;
  responseMode?: CrmResponseMode | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

export interface CrmWindowSummaryBucket<T extends string> {
  key: T;
  cohortLeads: number;
  bookedEverAny: number;
  bookedEverKept: number;
  bookedInWindowAny: number;
  bookedInWindowKept: number;
  cohortConversionRateAny: number;
  cohortConversionRateKept: number;
  inWindowBookingRateAny: number;
  inWindowBookingRateKept: number;
}

export interface CrmWindowSummary {
  totals: {
    cohortLeads: number;
    bookedEverAny: number;
    bookedEverKept: number;
    bookedInWindowAny: number;
    bookedInWindowKept: number;
    cohortConversionRateAny: number;
    cohortConversionRateKept: number;
    inWindowBookingRateAny: number;
    inWindowBookingRateKept: number;
  };
  byResponseType: Array<CrmWindowSummaryBucket<CrmResponseType>>;
  byResponseMode: Array<CrmWindowSummaryBucket<CrmResponseMode | "AI" | "HUMAN" | "UNKNOWN">>;
  bySetter: Array<
    CrmWindowSummaryBucket<string> & {
      label: string;
    }
  >;
}

export async function getCrmWindowSummary(params: {
  clientId?: string | null;
  filters?: CrmSheetFilters;
  authUser?: AnalyticsAuthUser;
}): Promise<{ success: boolean; data?: CrmWindowSummary; error?: string }> {
  try {
    const user = params.authUser ?? (await requireAuthUser());
    const clientId = params.clientId ?? null;

    if (!clientId) {
      return {
        success: true,
        data: {
          totals: {
            cohortLeads: 0,
            bookedEverAny: 0,
            bookedEverKept: 0,
            bookedInWindowAny: 0,
            bookedInWindowKept: 0,
            cohortConversionRateAny: 0,
            cohortConversionRateKept: 0,
            inWindowBookingRateAny: 0,
            inWindowBookingRateKept: 0,
          },
          byResponseType: [],
          byResponseMode: [],
          bySetter: [],
        },
      };
    }

    const scope = await resolveAnalyticsClientScope(user, clientId);
    if (!scope?.clientId) {
      return { success: false, error: "Unauthorized" };
    }
    const scopedClientId = scope.clientId;

    const filters = params.filters ?? {};
    const whereParts: Prisma.Sql[] = [Prisma.sql`l."clientId" = ${scopedClientId}`];

    if (filters.leadStatus) {
      whereParts.push(Prisma.sql`l.status = ${filters.leadStatus}`);
    }

    if (filters.leadCategory) {
      const pattern = `%${filters.leadCategory}%`;
      whereParts.push(
        Prisma.sql`(lcr."leadCategoryOverride" ILIKE ${pattern} OR lcr."interestType" ILIKE ${pattern})`
      );
    }

    if (filters.campaign) {
      const pattern = `%${filters.campaign}%`;
      whereParts.push(Prisma.sql`lcr."interestCampaignName" ILIKE ${pattern}`);
    }

    const responseModeFilter = filters.responseMode ?? null;
    const dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : null;
    const dateTo = filters.dateTo ? new Date(filters.dateTo) : null;
    if (dateFrom && Number.isFinite(dateFrom.getTime())) {
      whereParts.push(Prisma.sql`lcr."interestRegisteredAt" >= ${dateFrom}`);
    }
    if (dateTo && Number.isFinite(dateTo.getTime())) {
      whereParts.push(Prisma.sql`lcr."interestRegisteredAt" < ${dateTo}`);
    }

    const whereSql = Prisma.join(whereParts, " AND ");
    const bookedWindowFrom = dateFrom && Number.isFinite(dateFrom.getTime()) ? dateFrom : null;
    const bookedWindowTo = dateTo && Number.isFinite(dateTo.getTime()) ? dateTo : null;
    const bookedInWindowAnySql =
      bookedWindowFrom && bookedWindowTo
        ? Prisma.sql`(
            c."appointmentBookedAt" IS NOT NULL
            AND c."appointmentBookedAt" >= ${bookedWindowFrom}
            AND c."appointmentBookedAt" < ${bookedWindowTo}
          )`
        : Prisma.sql`false`;
    const bookedInWindowKeptSql =
      bookedWindowFrom && bookedWindowTo
        ? Prisma.sql`(
            c."appointmentBookedAt" IS NOT NULL
            AND c."appointmentBookedAt" >= ${bookedWindowFrom}
            AND c."appointmentBookedAt" < ${bookedWindowTo}
            AND NOT (c."appointmentStatus" = 'canceled' OR c."appointmentCanceledAt" IS NOT NULL)
          )`
        : Prisma.sql`false`;
    const responseModePredicateSql = responseModeFilter
      ? Prisma.sql`effective_response_mode = ${responseModeFilter}`
      : Prisma.sql`true`;

    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = 15000`;
      return tx.$queryRaw<
        Array<{
          totals:
            | {
                cohortLeads: number;
                bookedEverAny: number;
                bookedEverKept: number;
                bookedInWindowAny: number;
                bookedInWindowKept: number;
              }
            | null;
          byResponseType:
            | Array<{
                responseType: string;
                cohortLeads: number;
                bookedEverAny: number;
                bookedEverKept: number;
                bookedInWindowAny: number;
                bookedInWindowKept: number;
              }>
            | null;
          byResponseMode:
            | Array<{
                responseMode: string;
                cohortLeads: number;
                bookedEverAny: number;
                bookedEverKept: number;
                bookedInWindowAny: number;
                bookedInWindowKept: number;
              }>
            | null;
          bySetter:
            | Array<{
                setterKey: string;
                cohortLeads: number;
                bookedEverAny: number;
                bookedEverKept: number;
                bookedInWindowAny: number;
                bookedInWindowKept: number;
              }>
            | null;
        }>
      >(Prisma.sql`
      WITH cohort AS (
        SELECT
          lcr."leadId",
          lcr."responseMode",
          lcr."responseSentByUserId",
          lcr."interestRegisteredAt",
          lcr."interestChannel",
          l."sentimentTag",
          l."snoozedUntil",
          l."appointmentBookedAt",
          l."appointmentStatus",
          l."appointmentCanceledAt",
          l."ghlAppointmentId",
          l."calendlyInviteeUri"
        FROM "LeadCrmRow" lcr
        JOIN "Lead" l ON l.id = lcr."leadId"
        WHERE ${whereSql}
      ),
      first_response AS (
        SELECT DISTINCT ON (m."leadId")
          m."leadId",
          m."sentBy",
          m."sentByUserId"
        FROM "Message" m
        JOIN cohort c ON c."leadId" = m."leadId"
        WHERE m.direction = 'outbound'
          AND c."interestChannel" IS NOT NULL
          AND c."interestRegisteredAt" IS NOT NULL
          AND m.channel = c."interestChannel"
          AND m."sentAt" > c."interestRegisteredAt"
        ORDER BY m."leadId", m."sentAt" ASC
      ),
      joined AS (
        SELECT
          c."leadId" as lead_id,
          c."sentimentTag" as sentiment_tag,
          c."snoozedUntil" as snoozed_until,
          c."appointmentBookedAt" as appointment_booked_at,
          (c."appointmentBookedAt" IS NOT NULL OR c."ghlAppointmentId" IS NOT NULL OR c."calendlyInviteeUri" IS NOT NULL) as booked_any_evidence,
          (
            (c."appointmentBookedAt" IS NOT NULL OR c."ghlAppointmentId" IS NOT NULL OR c."calendlyInviteeUri" IS NOT NULL)
            AND NOT (c."appointmentStatus" = 'canceled' OR c."appointmentCanceledAt" IS NOT NULL)
          ) as booked_evidence,
          (
            ${bookedInWindowAnySql}
          ) as booked_in_window_any,
          (
            ${bookedInWindowKeptSql}
          ) as booked_in_window,
          COALESCE(
            c."responseMode"::text,
            CASE
              WHEN fr."sentBy" = 'ai' THEN 'AI'
              WHEN fr."sentByUserId" IS NOT NULL OR fr."sentBy" = 'setter' THEN 'HUMAN'
              ELSE 'UNKNOWN'
            END
          ) as effective_response_mode,
          COALESCE(c."responseSentByUserId", fr."sentByUserId") as effective_response_user_id
        FROM cohort c
        LEFT JOIN first_response fr ON fr."leadId" = c."leadId"
      ),
      typed AS (
        SELECT
          *,
          CASE
            WHEN booked_any_evidence OR sentiment_tag IN ('Meeting Booked', 'Meeting Requested', 'Call Requested') THEN 'MEETING_REQUEST'
            WHEN sentiment_tag = 'Information Requested' THEN 'INFORMATION_REQUEST'
            WHEN sentiment_tag = 'Objection' THEN 'OBJECTION'
            WHEN sentiment_tag = 'Follow Up' THEN 'FOLLOW_UP_FUTURE'
            ELSE 'OTHER'
          END as response_type,
          CASE
            WHEN effective_response_mode = 'AI' THEN 'AI'
            WHEN effective_response_mode = 'HUMAN' THEN COALESCE(effective_response_user_id, 'UNATTRIBUTED_HUMAN')
            ELSE 'UNKNOWN'
          END as setter_key
        FROM joined
        WHERE ${responseModePredicateSql}
      )
      SELECT
        (
          SELECT json_build_object(
            'cohortLeads', COUNT(*)::int,
            'bookedEverAny', COALESCE(SUM(CASE WHEN booked_any_evidence THEN 1 ELSE 0 END), 0)::int,
            'bookedEverKept', COALESCE(SUM(CASE WHEN booked_evidence THEN 1 ELSE 0 END), 0)::int,
            'bookedInWindowAny', COALESCE(SUM(CASE WHEN booked_in_window_any THEN 1 ELSE 0 END), 0)::int,
            'bookedInWindowKept', COALESCE(SUM(CASE WHEN booked_in_window THEN 1 ELSE 0 END), 0)::int
          )
          FROM typed
        ) as totals,
        (
          SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t."cohortLeads" DESC), '[]'::json)
          FROM (
            SELECT
              response_type as "responseType",
              COUNT(*)::int as "cohortLeads",
              COALESCE(SUM(CASE WHEN booked_any_evidence THEN 1 ELSE 0 END), 0)::int as "bookedEverAny",
              COALESCE(SUM(CASE WHEN booked_evidence THEN 1 ELSE 0 END), 0)::int as "bookedEverKept",
              COALESCE(SUM(CASE WHEN booked_in_window_any THEN 1 ELSE 0 END), 0)::int as "bookedInWindowAny",
              COALESCE(SUM(CASE WHEN booked_in_window THEN 1 ELSE 0 END), 0)::int as "bookedInWindowKept"
            FROM typed
            GROUP BY response_type
          ) t
        ) as "byResponseType",
        (
          SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t."cohortLeads" DESC), '[]'::json)
          FROM (
            SELECT
              effective_response_mode as "responseMode",
              COUNT(*)::int as "cohortLeads",
              COALESCE(SUM(CASE WHEN booked_any_evidence THEN 1 ELSE 0 END), 0)::int as "bookedEverAny",
              COALESCE(SUM(CASE WHEN booked_evidence THEN 1 ELSE 0 END), 0)::int as "bookedEverKept",
              COALESCE(SUM(CASE WHEN booked_in_window_any THEN 1 ELSE 0 END), 0)::int as "bookedInWindowAny",
              COALESCE(SUM(CASE WHEN booked_in_window THEN 1 ELSE 0 END), 0)::int as "bookedInWindowKept"
            FROM typed
            GROUP BY effective_response_mode
          ) t
        ) as "byResponseMode",
        (
          SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t."cohortLeads" DESC), '[]'::json)
          FROM (
            SELECT
              setter_key as "setterKey",
              COUNT(*)::int as "cohortLeads",
              COALESCE(SUM(CASE WHEN booked_any_evidence THEN 1 ELSE 0 END), 0)::int as "bookedEverAny",
              COALESCE(SUM(CASE WHEN booked_evidence THEN 1 ELSE 0 END), 0)::int as "bookedEverKept",
              COALESCE(SUM(CASE WHEN booked_in_window_any THEN 1 ELSE 0 END), 0)::int as "bookedInWindowAny",
              COALESCE(SUM(CASE WHEN booked_in_window THEN 1 ELSE 0 END), 0)::int as "bookedInWindowKept"
            FROM typed
            GROUP BY setter_key
            ORDER BY "cohortLeads" DESC
            LIMIT 20
          ) t
        ) as "bySetter"
      ;
    `);
    });

    const payload = rows[0] ?? null;
    const totalsRaw = payload?.totals ?? {
      cohortLeads: 0,
      bookedEverAny: 0,
      bookedEverKept: 0,
      bookedInWindowAny: 0,
      bookedInWindowKept: 0,
    };
    const cohortLeads = Number(totalsRaw.cohortLeads) || 0;
    const bookedEverAny = Number(totalsRaw.bookedEverAny) || 0;
    const bookedEverKept = Number(totalsRaw.bookedEverKept) || 0;
    const bookedInWindowAny = Number(totalsRaw.bookedInWindowAny) || 0;
    const bookedInWindowKept = Number(totalsRaw.bookedInWindowKept) || 0;

    const userIds = new Set<string>();
    const bySetterRaw = payload?.bySetter ?? [];
    for (const row of bySetterRaw) {
      const key = row.setterKey;
      if (key && key !== "AI" && key !== "UNKNOWN" && key !== "UNATTRIBUTED_HUMAN") userIds.add(key);
    }

    let emailMap = new Map<string, string | null>();
    if (userIds.size > 0) {
      try {
        emailMap = await getSupabaseUserEmailsByIds([...userIds]);
      } catch (error) {
        console.warn("[getCrmWindowSummary] Failed to resolve setter emails:", error);
      }
    }

    const bySetter = (bySetterRaw ?? []).map((row) => {
      const key = row.setterKey;
      const label =
        key === "AI"
          ? "AI"
          : key === "UNKNOWN"
            ? "Unknown"
            : key === "UNATTRIBUTED_HUMAN"
              ? "Unattributed"
              : emailMap.get(key) ?? key;

      return {
        key,
        label,
        cohortLeads: row.cohortLeads,
        bookedEverAny: row.bookedEverAny,
        bookedEverKept: row.bookedEverKept,
        bookedInWindowAny: row.bookedInWindowAny,
        bookedInWindowKept: row.bookedInWindowKept,
        cohortConversionRateAny: safeRate(row.bookedEverAny, row.cohortLeads),
        cohortConversionRateKept: safeRate(row.bookedEverKept, row.cohortLeads),
        inWindowBookingRateAny: safeRate(row.bookedInWindowAny, row.cohortLeads),
        inWindowBookingRateKept: safeRate(row.bookedInWindowKept, row.cohortLeads),
      };
    });

    const byResponseType = (payload?.byResponseType ?? []).map((row) => {
      const cohortLeads = row.cohortLeads;
      const bookedEverAny = row.bookedEverAny;
      const bookedEverKept = row.bookedEverKept;
      const bookedInWindowAny = row.bookedInWindowAny;
      const bookedInWindowKept = row.bookedInWindowKept;

      return {
        key: row.responseType as CrmResponseType,
        cohortLeads,
        bookedEverAny,
        bookedEverKept,
        bookedInWindowAny,
        bookedInWindowKept,
        cohortConversionRateAny: safeRate(bookedEverAny, cohortLeads),
        cohortConversionRateKept: safeRate(bookedEverKept, cohortLeads),
        inWindowBookingRateAny: safeRate(bookedInWindowAny, cohortLeads),
        inWindowBookingRateKept: safeRate(bookedInWindowKept, cohortLeads),
      };
    });

    const byResponseMode = (payload?.byResponseMode ?? []).map((row) => {
      const cohortLeads = row.cohortLeads;
      const bookedEverAny = row.bookedEverAny;
      const bookedEverKept = row.bookedEverKept;
      const bookedInWindowAny = row.bookedInWindowAny;
      const bookedInWindowKept = row.bookedInWindowKept;

      return {
        key: (row.responseMode as CrmResponseMode) ?? "UNKNOWN",
        cohortLeads,
        bookedEverAny,
        bookedEverKept,
        bookedInWindowAny,
        bookedInWindowKept,
        cohortConversionRateAny: safeRate(bookedEverAny, cohortLeads),
        cohortConversionRateKept: safeRate(bookedEverKept, cohortLeads),
        inWindowBookingRateAny: safeRate(bookedInWindowAny, cohortLeads),
        inWindowBookingRateKept: safeRate(bookedInWindowKept, cohortLeads),
      };
    });

    const data: CrmWindowSummary = {
      totals: {
        cohortLeads,
        bookedEverAny,
        bookedEverKept,
        bookedInWindowAny,
        bookedInWindowKept,
        cohortConversionRateAny: safeRate(bookedEverAny, cohortLeads),
        cohortConversionRateKept: safeRate(bookedEverKept, cohortLeads),
        inWindowBookingRateAny: safeRate(bookedInWindowAny, cohortLeads),
        inWindowBookingRateKept: safeRate(bookedInWindowKept, cohortLeads),
      },
      byResponseType,
      byResponseMode,
      bySetter,
    };

    return { success: true, data };
  } catch (error) {
    console.error("[getCrmWindowSummary] Failed:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to fetch CRM summary" };
  }
}

function buildAccessibleLeadSqlWhere(opts: {
  userId: string;
  clientId?: string | null;
  clientIds?: string[];
}): Prisma.Sql {
  if (opts.clientId) {
    return Prisma.sql`l."clientId" = ${opts.clientId}`;
  }

  if (Array.isArray(opts.clientIds)) {
    if (opts.clientIds.length === 0) {
      return Prisma.sql`false`;
    }
    return Prisma.sql`l."clientId" IN (${Prisma.join(opts.clientIds)})`;
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
async function calculateResponseTimeMetricsSql(opts: {
  userId: string;
  clientId?: string | null;
  clientIds?: string[];
  window?: { from: Date; to: Date };
}): Promise<ResponseTimeMetrics> {
  const defaultMetrics: ResponseTimeMetrics = {
    setterResponseTime: { avgMs: 0, formatted: "N/A", sampleCount: 0 },
    clientResponseTime: { avgMs: 0, formatted: "N/A", sampleCount: 0 },
  };

  try {
    const windowTo = opts.window?.to ?? new Date();
    const windowFrom = opts.window?.from ?? new Date(windowTo.getTime() - 30 * 24 * 60 * 60 * 1000);

    const accessibleWhere = buildAccessibleLeadSqlWhere({
      userId: opts.userId,
      clientId: opts.clientId,
      clientIds: opts.clientIds,
    });
    const bh1 = sqlIsWithinEstBusinessHours(Prisma.sql`sent_at`);
    const bh2 = sqlIsWithinEstBusinessHours(Prisma.sql`next_sent_at`);

    const rows = await prisma.$transaction(async (tx) => {
      // Keep overview responsive under large message volumes. If this query times out,
      // we fail open to "N/A" rather than delaying the entire analytics payload.
      await tx.$executeRaw`SET LOCAL statement_timeout = 5000`;
      return tx.$queryRaw<
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
          WHERE m."sentAt" >= ${windowFrom}
            AND m."sentAt" < ${windowTo}
            AND ${accessibleWhere}
        )
        SELECT
          AVG(EXTRACT(EPOCH FROM (next_sent_at - sent_at)) * 1000)
            FILTER (
              WHERE
                next_sent_at IS NOT NULL
                AND next_sent_at > sent_at
                AND next_sent_at < ${windowTo}
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
                AND next_sent_at < ${windowTo}
                AND next_sent_at <= sent_at + INTERVAL '7 days'
                AND direction = 'inbound'
                AND next_direction = 'outbound'
                AND ${bh1}
                AND ${bh2}
          )::bigint AS setter_count,
          AVG(EXTRACT(EPOCH FROM (next_sent_at - sent_at)) * 1000)
            FILTER (
              WHERE
                next_sent_at IS NOT NULL
                AND next_sent_at > sent_at
                AND next_sent_at < ${windowTo}
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
                AND next_sent_at < ${windowTo}
                AND next_sent_at <= sent_at + INTERVAL '7 days'
                AND direction = 'outbound'
                AND next_direction = 'inbound'
                AND ${bh1}
                AND ${bh2}
          )::bigint AS client_count
        FROM ordered
      `;
    });

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
async function calculatePerSetterResponseTimesSql(opts: {
  clientId: string;
  window?: { from: Date; to: Date };
}): Promise<SetterResponseTimeRow[]> {
  try {
    const windowTo = opts.window?.to ?? new Date();
    const windowFrom = opts.window?.from ?? new Date(windowTo.getTime() - 30 * 24 * 60 * 60 * 1000);

    const bh1 = sqlIsWithinEstBusinessHours(Prisma.sql`sent_at`);
    const bh2 = sqlIsWithinEstBusinessHours(Prisma.sql`next_sent_at`);

    const rawRows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = 5000`;
      return tx.$queryRaw<
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
          WHERE m."sentAt" >= ${windowFrom}
            AND m."sentAt" < ${windowTo}
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
          AND next_sent_at < ${windowTo}
          AND next_sent_at <= sent_at + INTERVAL '7 days'
          AND direction = 'inbound'
          AND next_direction = 'outbound'
          AND next_sent_by_user_id IS NOT NULL
          AND ${bh1}
          AND ${bh2}
        GROUP BY next_sent_by_user_id
        ORDER BY response_count DESC
      `;
    });

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
 * @param opts.window - Optional analytics window (ISO from/to)
 */
export async function getAnalytics(
  clientId?: string | null,
  opts?: {
    forceRefresh?: boolean;
    window?: AnalyticsWindow;
    parts?: AnalyticsOverviewParts;
    authUser?: AnalyticsAuthUser;
  }
): Promise<{
  success: boolean;
  data?: AnalyticsData;
  error?: string;
}> {
  try {
    const user = opts?.authUser ?? (await requireAuthUser());
    const scope = await resolveAnalyticsClientScope(user, clientId);
    if (!scope) return { success: false, error: "Unauthorized" };
    const scopedClientId = scope.clientId;
    const scopedClientIds = scope.clientIds;

    const windowState = resolveAnalyticsWindow(opts?.window);
    const windowFrom = windowState.from;
    const windowTo = windowState.to;
    const hasWindow = Boolean(windowFrom && windowTo);
    const parts = opts?.parts ?? "all";
    const includeCore = parts !== "breakdowns";
    const includeBreakdowns = parts !== "core";

    // Cleanup stale cache entries periodically
    maybeCleanupCache();

    // Cache is user-scoped to avoid cross-user data leakage.
    const cacheKey = `${user.id}:${scopedClientId || "__all__"}:${windowState.key}:${parts}`;
    const redisKey = `analytics:v1:${cacheKey}`;
    const now = Date.now();

    if (!opts?.forceRefresh) {
      const cached = analyticsCache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        return { success: true, data: cached.data };
      }

      const redisCached = await redisGetJson<AnalyticsData>(redisKey);
      if (redisCached) {
        analyticsCache.set(cacheKey, {
          data: redisCached,
          expiresAt: now + ANALYTICS_CACHE_TTL_MS,
        });
        return { success: true, data: redisCached };
      }
    }

    const leadWhere: Prisma.LeadWhereInput = scopedClientId
      ? { clientId: scopedClientId }
      : scopedClientIds.length > 0
        ? { clientId: { in: scopedClientIds } }
        : { id: "__no_access__" };
    const leadCreatedWindow = hasWindow ? { createdAt: { gte: windowFrom!, lt: windowTo! } } : {};
    const messageWindow = hasWindow ? { sentAt: { gte: windowFrom!, lt: windowTo! } } : {};

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

    const respondedLeadFilter = {
      ...leadWhere,
      messages: {
        some: {
          direction: "inbound",
          ...messageWindow,
        },
      },
    };

    let totalLeads = 0;
    let outboundLeadsContacted = 0;
    let responses = 0;
    let responseRate = 0;
    let meetingsBooked = 0;
    let responseTimeMetrics: ResponseTimeMetrics = {
      setterResponseTime: { avgMs: 0, formatted: "N/A", sampleCount: 0 },
      clientResponseTime: { avgMs: 0, formatted: "N/A", sampleCount: 0 },
    };
    let capacity: CapacityUtilization | null = null;

    let sentimentBreakdown: AnalyticsData["sentimentBreakdown"] = [];
    let leadsByStatus: AnalyticsData["leadsByStatus"] = [];
    let weeklyStats: AnalyticsData["weeklyStats"] = [];
    let topClients: AnalyticsData["topClients"] = [];
    let smsSubClients: AnalyticsData["smsSubClients"] = [];
    let perSetterResponseTimes: AnalyticsData["perSetterResponseTimes"] = [];

    if (includeCore) {
      const [nextTotalLeads, nextOutboundLeadsContacted, nextResponses, nextMeetingsBooked, nextResponseTimeMetrics, nextCapacity] =
        await Promise.all([
          // Total leads (windowed by createdAt when a window is provided).
          prisma.lead.count({
            where: { ...leadWhere, ...leadCreatedWindow },
          }),
          // Outbound leads contacted (best-effort from DB only; outbound SMS from GHL automations isn't ingested yet).
          prisma.lead.count({
            where: {
              ...leadWhere,
              messages: {
                some: {
                  direction: "outbound",
                  ...messageWindow,
                },
              },
            },
          }),
          // Responses = unique leads with inbound messages.
          prisma.lead.count({
            where: respondedLeadFilter,
          }),
          // Meetings booked.
          prisma.lead.count({
            where: {
              ...leadWhere,
              ...(hasWindow
                ? { appointmentBookedAt: { gte: windowFrom!, lt: windowTo! } }
                : {
                    OR: [
                      { appointmentBookedAt: { not: null } },
                      { ghlAppointmentId: { not: null } },
                      { calendlyInviteeUri: { not: null } },
                      { calendlyScheduledEventUri: { not: null } },
                    ],
                  }),
            },
          }),
          calculateResponseTimeMetricsSql({
            userId: user.id,
            clientId: scopedClientId,
            clientIds: scopedClientIds,
            window: hasWindow ? { from: windowFrom!, to: windowTo! } : undefined,
          }),
          scopedClientId
            ? getWorkspaceCapacityUtilization({ clientId: scopedClientId, windowDays: 30 }).catch((error) => {
                console.warn("[Analytics] Failed to compute workspace capacity utilization:", error);
                return null;
              })
            : Promise.resolve(null),
        ]);

      totalLeads = nextTotalLeads;
      outboundLeadsContacted = nextOutboundLeadsContacted;
      responses = nextResponses;
      meetingsBooked = nextMeetingsBooked;
      responseTimeMetrics = nextResponseTimeMetrics;
      capacity = nextCapacity;

      // Response rate = responses / outbound leads contacted
      responseRate = outboundLeadsContacted > 0
        ? Math.round((responses / outboundLeadsContacted) * 100)
        : 0;
    }

    if (includeBreakdowns) {
      // Message stats (windowed when provided; defaults to last 7 days)
      const statsTo = hasWindow ? new Date(windowTo!) : new Date();
      const statsFrom = hasWindow ? new Date(windowFrom!) : new Date(statsTo);
      if (!hasWindow) {
        statsFrom.setDate(statsFrom.getDate() - 6); // 6 days ago + today = 7 days
      }

      const responsesForBreakdownsPromise = includeCore
        ? Promise.resolve(responses)
        : prisma.lead.count({ where: respondedLeadFilter });
      const totalLeadsForBreakdownsPromise = includeCore
        ? Promise.resolve(totalLeads)
        : prisma.lead.count({ where: { ...leadWhere, ...leadCreatedWindow } });
      const sentimentCountsPromise = prisma.lead.groupBy({
        by: ["sentimentTag"],
        where: respondedLeadFilter,
        _count: {
          _all: true,
        },
      });
      const statusCountsPromise = prisma.lead.groupBy({
        by: ["status"],
        where: { ...leadWhere, ...leadCreatedWindow },
        _count: {
          status: true,
        },
      });
      const weeklyMessageStatsPromise = prisma.$queryRaw<
        Array<{ day_date: Date; direction: string; count: bigint }>
      >`
        SELECT
          DATE_TRUNC('day', m."sentAt") as day_date,
          m.direction,
          COUNT(*) as count
        FROM "Message" m
        INNER JOIN "Lead" l ON m."leadId" = l.id
        WHERE ${buildAccessibleLeadSqlWhere({
          userId: user.id,
          clientId: scopedClientId,
          clientIds: scopedClientIds,
        })}
          AND m."sentAt" >= ${statsFrom}
          AND m."sentAt" < ${statsTo}
        GROUP BY DATE_TRUNC('day', m."sentAt"), m.direction
        ORDER BY day_date ASC
      `;
      const leadCountsByClientPromise = prisma.lead.groupBy({
        by: ["clientId"],
        where: { ...leadWhere, ...leadCreatedWindow },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 5,
      });
      const meetingCountsByClientPromise = prisma.lead.groupBy({
        by: ["clientId"],
        where: {
          ...leadWhere,
          ...(hasWindow
            ? { appointmentBookedAt: { gte: windowFrom!, lt: windowTo! } }
            : {
                OR: [
                  { appointmentBookedAt: { not: null } },
                  { ghlAppointmentId: { not: null } },
                  { calendlyInviteeUri: { not: null } },
                  { calendlyScheduledEventUri: { not: null } },
                ],
              }),
        },
        _count: { id: true },
      });
      const perSetterResponseTimesPromise = scopedClientId
        ? calculatePerSetterResponseTimesSql({
            clientId: scopedClientId,
            window: hasWindow ? { from: windowFrom!, to: windowTo! } : undefined,
          })
        : Promise.resolve<SetterResponseTimeRow[]>([]);

      const [
        responsesForBreakdowns,
        totalLeadsForBreakdowns,
        sentimentCounts,
        statusCounts,
        weeklyMessageStats,
        leadCountsByClient,
        meetingCountsByClient,
        nextPerSetterResponseTimes,
      ] = await Promise.all([
        responsesForBreakdownsPromise,
        totalLeadsForBreakdownsPromise,
        sentimentCountsPromise,
        statusCountsPromise,
        weeklyMessageStatsPromise,
        leadCountsByClientPromise,
        meetingCountsByClientPromise,
        perSetterResponseTimesPromise,
      ]);

      const sentimentAgg = new Map<string, number>();
      for (const row of sentimentCounts) {
        const raw = row.sentimentTag;
        // "New" means "no inbound replies yet" and shouldn't show up in response sentiment.
        const sentiment = !raw || raw === "New" ? "Unknown" : raw;
        sentimentAgg.set(sentiment, (sentimentAgg.get(sentiment) ?? 0) + row._count._all);
      }

      sentimentBreakdown = Array.from(sentimentAgg.entries()).map(([sentiment, count]) => ({
        sentiment,
        count,
        percentage: responsesForBreakdowns > 0 ? (count / responsesForBreakdowns) * 100 : 0,
      }));

      leadsByStatus = statusCounts.map((s) => ({
        status: s.status,
        count: s._count.status,
        percentage: totalLeadsForBreakdowns > 0
          ? Math.round((s._count.status / totalLeadsForBreakdowns) * 100)
          : 0,
      }));

      // Normalize to day boundaries for chart labels
      const statsStartDay = new Date(statsFrom);
      statsStartDay.setHours(0, 0, 0, 0);
      const statsEndDay = new Date(Math.max(statsStartDay.getTime(), statsTo.getTime() - 1));
      statsEndDay.setHours(0, 0, 0, 0);

      // Build a lookup map for quick access
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const statsMap = new Map<string, { inbound: number; outbound: number }>();

      for (const row of weeklyMessageStats) {
        const dateKey = new Date(row.day_date).toISOString().split("T")[0];
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

      // Build the stats array for the window
      const msPerDay = 24 * 60 * 60 * 1000;
      const totalDays =
        Math.max(0, Math.floor((statsEndDay.getTime() - statsStartDay.getTime()) / msPerDay)) + 1;
      const useDateLabels = totalDays > 7;

      weeklyStats = [];
      for (let i = 0; i < totalDays; i++) {
        const date = new Date(statsStartDay);
        date.setDate(statsStartDay.getDate() + i);
        const dateKey = date.toISOString().split("T")[0];
        const stats = statsMap.get(dateKey) || { inbound: 0, outbound: 0 };

        weeklyStats.push({
          day: useDateLabels
            ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : dayNames[date.getDay()],
          inbound: stats.inbound,
          outbound: stats.outbound,
        });
      }

      const topClientIds = leadCountsByClient.map((r) => r.clientId);
      const clients = topClientIds.length
        ? await prisma.client.findMany({
            where: { id: { in: topClientIds } },
            select: { id: true, name: true },
          })
        : [];

      const clientNameById = new Map(clients.map((c) => [c.id, c.name]));
      const meetingCountByClient = new Map(meetingCountsByClient.map((r) => [r.clientId, r._count.id]));

      topClients = leadCountsByClient.map((row) => ({
        name: clientNameById.get(row.clientId) ?? "Unknown",
        leads: row._count.id,
        meetings: meetingCountByClient.get(row.clientId) ?? 0,
      }));

      // SMS sub-client breakdown inside a workspace (Lead.smsCampaignId)
      smsSubClients = [];
      if (scopedClientId) {
        const positiveSentimentTags = [...POSITIVE_SENTIMENTS, "Positive"] as unknown as string[];

        const [campaigns, leadsBySmsCampaign, responsesBySmsCampaign, meetingsBySmsCampaign] = await Promise.all([
          prisma.smsCampaign.findMany({
            where: { clientId: scopedClientId },
            select: { id: true, name: true },
          }),
          prisma.lead.groupBy({
            by: ["smsCampaignId"],
            where: {
              clientId: scopedClientId,
              sentimentTag: { in: positiveSentimentTags },
              ...(hasWindow ? { lastInboundAt: { gte: windowFrom!, lt: windowTo! } } : {}),
            },
            _count: { _all: true },
          }),
          prisma.lead.groupBy({
            by: ["smsCampaignId"],
            where: {
              clientId: scopedClientId,
              messages: { some: { direction: "inbound", ...messageWindow } },
            },
            _count: { _all: true },
          }),
          prisma.lead.groupBy({
            by: ["smsCampaignId"],
            where: {
              clientId: scopedClientId,
              ...(hasWindow
                ? { appointmentBookedAt: { gte: windowFrom!, lt: windowTo! } }
                : {
                    OR: [
                      { appointmentBookedAt: { not: null } },
                      { ghlAppointmentId: { not: null } },
                      { calendlyInviteeUri: { not: null } },
                      { calendlyScheduledEventUri: { not: null } },
                    ],
                  }),
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

      perSetterResponseTimes = nextPerSetterResponseTimes;
    }

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
        capacity: capacity || undefined,
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
    void redisSetJson(redisKey, analyticsData, {
      exSeconds: Math.ceil(ANALYTICS_CACHE_TTL_MS / 1000),
    });

    return { success: true, data: analyticsData };
  } catch (error) {
    console.error("Failed to fetch analytics:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "Not authenticated" || message === "Unauthorized") {
      return { success: false, error: message };
    }
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
  authUser?: AnalyticsAuthUser;
}): Promise<{
  success: boolean;
  data?: { campaigns: EmailCampaignKpiRow[]; weeklyReport: WeeklyEmailCampaignReport };
  error?: string;
}> {
  try {
    const user = opts?.authUser ?? (await requireAuthUser());
    const scope = await resolveAnalyticsClientScope(user, opts?.clientId ?? null);
    if (!scope) return { success: false, error: "Unauthorized" };
    const scopedClientIds = scope.clientIds;
    const scopedClientId = scope.clientId;

    const now = new Date();
    const to = opts?.to ? new Date(opts.to) : now;
    const from = opts?.from ? new Date(opts.from) : new Date(new Date(to).setDate(to.getDate() - 7));

    const campaigns = await prisma.emailCampaign.findMany({
      where: {
        ...(scopedClientId ? { clientId: scopedClientId } : { clientId: { in: scopedClientIds } }),
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

    type BucketCounts = { positive: number; booked: number };
    type CampaignKpiAggregateRow = {
      campaign_id: string;
      positive_replies: bigint;
      meetings_requested: bigint;
      meetings_booked: bigint;
    };
    type SentimentAggregateRow = {
      sentiment: string | null;
      count: bigint;
    };
    type IndustryAggregateRow = {
      campaign_id: string;
      industry: string;
      positive_replies: bigint;
      meetings_booked: bigint;
    };
    type HeadcountAggregateRow = {
      campaign_id: string;
      raw_headcount: string;
      positive_replies: bigint;
      meetings_booked: bigint;
    };

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

    const accessibleWhere = buildAccessibleLeadSqlWhere({
      userId: user.id,
      clientId: scopedClientId,
      clientIds: scopedClientIds,
    });
    const campaignWhere = Prisma.sql`l."emailCampaignId" IN (${Prisma.join(campaignIds)})`;
    const positivePredicate = Prisma.sql`(
      l."lastInboundAt" >= ${from}
      AND l."lastInboundAt" < ${to}
      AND l."sentimentTag" IN (${Prisma.join([...KPI_POSITIVE_REPLIES])})
    )`;
    const meetingRequestedPredicate = Prisma.sql`(
      l."lastInboundAt" >= ${from}
      AND l."lastInboundAt" < ${to}
      AND l."sentimentTag" IN (${Prisma.join([...KPI_MEETINGS_REQUESTED])})
    )`;
    const calendlyCampaignIds = campaigns
      .filter((campaign) => (clientProviderById.get(campaign.clientId) ?? "GHL") === "CALENDLY")
      .map((campaign) => campaign.id);
    const ghlCampaignIds = campaigns
      .filter((campaign) => (clientProviderById.get(campaign.clientId) ?? "GHL") !== "CALENDLY")
      .map((campaign) => campaign.id);
    const calendlyBookedPredicate = calendlyCampaignIds.length
      ? Prisma.sql`(
          l."emailCampaignId" IN (${Prisma.join(calendlyCampaignIds)})
          AND (l."calendlyInviteeUri" IS NOT NULL OR l."calendlyScheduledEventUri" IS NOT NULL)
        )`
      : Prisma.sql`false`;
    const ghlBookedPredicate = ghlCampaignIds.length
      ? Prisma.sql`(
          l."emailCampaignId" IN (${Prisma.join(ghlCampaignIds)})
          AND l."ghlAppointmentId" IS NOT NULL
        )`
      : Prisma.sql`false`;
    const bookedForProviderPredicate = Prisma.sql`(${calendlyBookedPredicate} OR ${ghlBookedPredicate})`;
    const bookedInRangePredicate = Prisma.sql`(
      l."appointmentBookedAt" >= ${from}
      AND l."appointmentBookedAt" < ${to}
      AND ${bookedForProviderPredicate}
    )`;

    const [campaignKpiRows, sentimentRows, industryRows, headcountRows] = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = 15000`;

        const campaignKpiRows = await tx.$queryRaw<CampaignKpiAggregateRow[]>`
          SELECT
            l."emailCampaignId"::text AS campaign_id,
            COUNT(*) FILTER (WHERE ${positivePredicate})::bigint AS positive_replies,
            COUNT(*) FILTER (WHERE ${meetingRequestedPredicate})::bigint AS meetings_requested,
            COUNT(*) FILTER (WHERE ${bookedInRangePredicate})::bigint AS meetings_booked
          FROM "Lead" l
          WHERE ${accessibleWhere}
            AND ${campaignWhere}
            AND (
              (l."lastInboundAt" >= ${from} AND l."lastInboundAt" < ${to})
              OR (l."appointmentBookedAt" >= ${from} AND l."appointmentBookedAt" < ${to})
            )
          GROUP BY l."emailCampaignId"
        `;

        const sentimentRows = await tx.$queryRaw<SentimentAggregateRow[]>`
          SELECT
            l."sentimentTag"::text AS sentiment,
            COUNT(*)::bigint AS count
          FROM "Lead" l
          WHERE ${accessibleWhere}
            AND ${campaignWhere}
            AND l."lastInboundAt" >= ${from}
            AND l."lastInboundAt" < ${to}
          GROUP BY l."sentimentTag"
        `;

        const industryRows = await tx.$queryRaw<IndustryAggregateRow[]>`
          SELECT
            l."emailCampaignId"::text AS campaign_id,
            COALESCE(NULLIF(BTRIM(l."industry"), ''), 'Unknown')::text AS industry,
            COUNT(*) FILTER (WHERE ${positivePredicate})::bigint AS positive_replies,
            COUNT(*) FILTER (WHERE ${bookedInRangePredicate})::bigint AS meetings_booked
          FROM "Lead" l
          WHERE ${accessibleWhere}
            AND ${campaignWhere}
            AND (${positivePredicate} OR ${bookedInRangePredicate})
          GROUP BY l."emailCampaignId", COALESCE(NULLIF(BTRIM(l."industry"), ''), 'Unknown')
        `;

        const headcountRows = await tx.$queryRaw<HeadcountAggregateRow[]>`
          SELECT
            l."emailCampaignId"::text AS campaign_id,
            COALESCE(NULLIF(BTRIM(l."employeeHeadcount"), ''), 'Unknown')::text AS raw_headcount,
            COUNT(*) FILTER (WHERE ${positivePredicate})::bigint AS positive_replies,
            COUNT(*) FILTER (WHERE ${bookedInRangePredicate})::bigint AS meetings_booked
          FROM "Lead" l
          WHERE ${accessibleWhere}
            AND ${campaignWhere}
            AND (${positivePredicate} OR ${bookedInRangePredicate})
          GROUP BY l."emailCampaignId", COALESCE(NULLIF(BTRIM(l."employeeHeadcount"), ''), 'Unknown')
        `;

        return [campaignKpiRows, sentimentRows, industryRows, headcountRows] as const;
      }
    );

    for (const row of campaignKpiRows) {
      const campaign = rowsByCampaignId.get(row.campaign_id);
      if (!campaign) continue;
      campaign.positiveReplies = Number(row.positive_replies ?? 0);
      campaign.meetingsRequested = Number(row.meetings_requested ?? 0);
      campaign.meetingsBooked = Number(row.meetings_booked ?? 0);
    }

    for (const row of sentimentRows) {
      const sentiment = !row.sentiment || row.sentiment === "New" ? "Unknown" : row.sentiment;
      sentimentAgg.set(sentiment, (sentimentAgg.get(sentiment) ?? 0) + Number(row.count ?? 0));
    }

    for (const row of industryRows) {
      const campaignId = row.campaign_id;
      const industry = row.industry || "Unknown";
      const positiveReplies = Number(row.positive_replies ?? 0);
      const meetingsBooked = Number(row.meetings_booked ?? 0);

      const globalIndustry = industryAgg.get(industry) ?? { positive: 0, booked: 0 };
      globalIndustry.positive += positiveReplies;
      globalIndustry.booked += meetingsBooked;
      industryAgg.set(industry, globalIndustry);

      const byCampaign = industryByCampaign.get(campaignId) ?? new Map<string, BucketCounts>();
      const current = byCampaign.get(industry) ?? { positive: 0, booked: 0 };
      current.positive += positiveReplies;
      current.booked += meetingsBooked;
      byCampaign.set(industry, current);
      industryByCampaign.set(campaignId, byCampaign);
    }

    for (const row of headcountRows) {
      const campaignId = row.campaign_id;
      const bucket = bucketHeadcount(row.raw_headcount);
      const positiveReplies = Number(row.positive_replies ?? 0);
      const meetingsBooked = Number(row.meetings_booked ?? 0);

      const globalHeadcount = headcountAgg.get(bucket) ?? { positive: 0, booked: 0 };
      globalHeadcount.positive += positiveReplies;
      globalHeadcount.booked += meetingsBooked;
      headcountAgg.set(bucket, globalHeadcount);

      const byCampaign = headcountByCampaign.get(campaignId) ?? new Map<HeadcountBucket, BucketCounts>();
      const current = byCampaign.get(bucket) ?? { positive: 0, booked: 0 };
      current.positive += positiveReplies;
      current.booked += meetingsBooked;
      byCampaign.set(bucket, current);
      headcountByCampaign.set(campaignId, byCampaign);
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
  clientId: string,
  opts?: { authUser?: AnalyticsAuthUser }
): Promise<{ success: true; data: SetterFunnelStats[] } | { success: false; error: string }> {
  try {
    const user = opts?.authUser ?? (await requireAuthUser());
    const scope = await resolveAnalyticsClientScope(user, clientId);
    if (!scope?.clientId) {
      return { success: false, error: "Unauthorized" };
    }
    const scopedClientId = scope.clientId;

    // Get all setters for this workspace
    const setters = await prisma.clientMember.findMany({
      where: { clientId: scopedClientId, role: "SETTER" },
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
          clientId: scopedClientId,
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

export async function getCrmSheetRows(params: {
  clientId?: string | null;
  cursor?: string | null;
  limit?: number;
  filters?: CrmSheetFilters;
  authUser?: AnalyticsAuthUser;
}): Promise<{
  success: boolean;
  data?: { rows: CrmSheetRow[]; nextCursor: string | null };
  error?: string;
}> {
  try {
    const user = params.authUser ?? (await requireAuthUser());
    const clientId = params.clientId ?? null;

    if (!clientId) {
      return { success: true, data: { rows: [], nextCursor: null } };
    }

    const scope = await resolveAnalyticsClientScope(user, clientId);
    if (!scope?.clientId) {
      return { success: false, error: "Unauthorized" };
    }
    const scopedClientId = scope.clientId;

    const limit = Math.min(params.limit ?? 100, 300);
    const filters = params.filters ?? {};
    const requestedResponseMode = filters.responseMode ?? null;

    const leadWhere: Prisma.LeadWhereInput = { clientId: scopedClientId };
    if (filters.leadStatus) {
      leadWhere.status = filters.leadStatus;
    }

    const rowWhere: Prisma.LeadCrmRowWhereInput = { lead: leadWhere };
    if (filters.leadCategory) {
      rowWhere.OR = [
        { leadCategoryOverride: { contains: filters.leadCategory, mode: "insensitive" } },
        { interestType: { contains: filters.leadCategory, mode: "insensitive" } },
      ];
    }
    if (filters.campaign) {
      rowWhere.interestCampaignName = { contains: filters.campaign, mode: "insensitive" };
    }

    if (filters.dateFrom || filters.dateTo) {
      const dateFilter: { gte?: Date; lt?: Date } = {};
      if (filters.dateFrom) {
        const parsed = new Date(filters.dateFrom);
        if (!Number.isNaN(parsed.getTime())) dateFilter.gte = parsed;
      }
      if (filters.dateTo) {
        const parsed = new Date(filters.dateTo);
        if (!Number.isNaN(parsed.getTime())) dateFilter.lt = parsed;
      }
      if (dateFilter.gte || dateFilter.lt) {
        rowWhere.interestRegisteredAt = dateFilter;
      }
    }

    // Effective mode is what we display (stored mode OR inferred from first outbound message).
    // When filtering by responseMode, match the effective mode so filters align with what users see.
    if (requestedResponseMode) {
      rowWhere.AND = [
        ...(Array.isArray(rowWhere.AND) ? rowWhere.AND : rowWhere.AND ? [rowWhere.AND] : []),
        { OR: [{ responseMode: requestedResponseMode }, { responseMode: null }] },
      ];
    }

    const orderBy: Prisma.LeadCrmRowOrderByWithRelationInput[] = [
      { interestRegisteredAt: "desc" },
      { createdAt: "desc" },
      { id: "desc" },
    ];
    const include = {
      lead: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          linkedinUrl: true,
          companyName: true,
          companyWebsite: true,
          jobTitle: true,
          status: true,
          sentimentTag: true,
          createdAt: true,
          snoozedUntil: true,
          assignedToUserId: true,
          appointmentBookedAt: true,
          appointmentStartAt: true,
          ghlAppointmentId: true,
          calendlyInviteeUri: true,
          overallScore: true,
          emailCampaign: { select: { name: true } },
          smsCampaign: { select: { name: true } },
          campaign: { select: { name: true } },
        },
      },
    } as const;

    type LeadCrmRowWithLead = Prisma.LeadCrmRowGetPayload<{ include: typeof include }>;

    let page: LeadCrmRowWithLead[] = [];
    let nextCursor: string | null = null;
    const scannedDerivedResponseModeByLeadId = new Map<string, CrmResponseMode>();

    if (!requestedResponseMode) {
      const rows = await prisma.leadCrmRow.findMany({
        where: rowWhere,
        orderBy,
        take: limit + 1,
        ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
        include,
      });

      const hasMore = rows.length > limit;
      page = hasMore ? rows.slice(0, limit) : rows;
      nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;
    } else {
      const batchTake = Math.min(limit * 2, 300);
      const maxScanPages = 6;

      const collected: LeadCrmRowWithLead[] = [];
      let scanCursor: string | null = params.cursor ?? null;
      let lastScannedRowId: string | null = null;
      let hasMoreBeyondLastScanned = false;

      const withTimeout = async <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
        return prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL statement_timeout = 10000`;
          return fn(tx);
        });
      };

      scanLoop: for (let scanPage = 0; scanPage < maxScanPages && collected.length < limit; scanPage++) {
        const rows = await prisma.leadCrmRow.findMany({
          where: rowWhere,
          orderBy,
          take: batchTake + 1,
          ...(scanCursor ? { cursor: { id: scanCursor }, skip: 1 } : {}),
          include,
        });

        const batchHasMore = rows.length > batchTake;
        const batchPageRows = batchHasMore ? rows.slice(0, batchTake) : rows;
        if (batchPageRows.length === 0) {
          hasMoreBeyondLastScanned = false;
          break;
        }

        const deriveLeadIds = [...new Set(batchPageRows.filter((row) => !row.responseMode).map((row) => row.leadId))];
        const derivedByLeadId = new Map<string, CrmResponseMode>();

        if (deriveLeadIds.length > 0) {
          try {
            const responseModeRows = await withTimeout((tx) =>
              tx.$queryRaw<Array<{ leadId: string; sentBy: string | null; sentByUserId: string | null }>>`
                SELECT DISTINCT ON (m."leadId")
                  m."leadId",
                  m."sentBy",
                  m."sentByUserId"
                FROM "Message" m
                JOIN "LeadCrmRow" lcr ON lcr."leadId" = m."leadId"
                WHERE m."leadId" IN (${Prisma.join(deriveLeadIds)})
                  AND m.direction = 'outbound'
                  AND lcr."interestChannel" IS NOT NULL
                  AND lcr."interestRegisteredAt" IS NOT NULL
                  AND m.channel = lcr."interestChannel"
                  AND m."sentAt" > lcr."interestRegisteredAt"
                ORDER BY m."leadId", m."sentAt" ASC
              `
            );

            for (const row of responseModeRows) {
              derivedByLeadId.set(row.leadId, deriveCrmResponseMode(row.sentBy, row.sentByUserId));
              scannedDerivedResponseModeByLeadId.set(
                row.leadId,
                deriveCrmResponseMode(row.sentBy, row.sentByUserId)
              );
            }
          } catch (error) {
            console.warn("[getCrmSheetRows] Derived response mode query failed:", error);
          }
        }

        for (let i = 0; i < batchPageRows.length; i++) {
          const row = batchPageRows[i];
          lastScannedRowId = row.id;

          const effectiveMode = row.responseMode ?? derivedByLeadId.get(row.leadId) ?? "UNKNOWN";
          if (effectiveMode === requestedResponseMode) {
            collected.push(row);
            if (collected.length >= limit) {
              hasMoreBeyondLastScanned = i < batchPageRows.length - 1 || batchHasMore;
              break scanLoop;
            }
          }
        }

        if (batchHasMore) {
          scanCursor = batchPageRows[batchPageRows.length - 1]?.id ?? null;
          hasMoreBeyondLastScanned = true;
          continue;
        }

        hasMoreBeyondLastScanned = false;
        break;
      }

      page = collected;
      nextCursor = hasMoreBeyondLastScanned ? lastScannedRowId : null;
    }

    const leadIds = page.map((row) => row.leadId);
    const stepRespondedByLeadId = new Map<string, number>();
    const responseStepCompleteByLeadId = new Set<string>();
    const responseModeByLeadId = new Map<string, CrmResponseMode>();
    const followUpsByLeadId = new Map<string, Date[]>();

    for (const [leadId, mode] of scannedDerivedResponseModeByLeadId.entries()) {
      responseModeByLeadId.set(leadId, mode);
    }

    if (leadIds.length > 0) {
      const withTimeout = async <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
        return prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL statement_timeout = 10000`;
          return fn(tx);
        });
      };

      const leadsMissingResponseMode = [
        ...new Set(
          page
            .filter((row) => !row.responseMode && !responseModeByLeadId.has(row.leadId))
            .map((row) => row.leadId)
        ),
      ];

      const touchRowsPromise = withTimeout((tx) =>
        tx.$queryRaw<Array<{ leadId: string; touch_count: bigint }>>`
          SELECT m."leadId", COUNT(*)::bigint as touch_count
          FROM "Message" m
          JOIN "LeadCrmRow" lcr ON lcr."leadId" = m."leadId"
          WHERE m."leadId" IN (${Prisma.join(leadIds)})
            AND m.direction = 'outbound'
            AND lcr."interestChannel" IS NOT NULL
            AND lcr."interestRegisteredAt" IS NOT NULL
            AND m.channel = lcr."interestChannel"
            AND m."sentAt" < lcr."interestRegisteredAt"
          GROUP BY m."leadId"
        `
      );
      const followUpRowsPromise = withTimeout((tx) =>
        tx.followUpTask.findMany({
          where: {
            leadId: { in: leadIds },
            status: "pending",
          },
          select: { leadId: true, dueDate: true },
          orderBy: [{ leadId: "asc" }, { dueDate: "asc" }],
        })
      );
      const responseRowsPromise = withTimeout((tx) =>
        tx.$queryRaw<Array<{ leadId: string }>>`
          SELECT DISTINCT m."leadId"
          FROM "Message" m
          JOIN "LeadCrmRow" lcr ON lcr."leadId" = m."leadId"
          WHERE m."leadId" IN (${Prisma.join(leadIds)})
            AND m.direction = 'outbound'
            AND lcr."interestChannel" IS NOT NULL
            AND lcr."interestRegisteredAt" IS NOT NULL
            AND m.channel = lcr."interestChannel"
            AND m."sentAt" > lcr."interestRegisteredAt"
        `
      );
      const responseModeRowsPromise: Promise<
        Array<{ leadId: string; sentBy: string | null; sentByUserId: string | null }>
      > =
        leadsMissingResponseMode.length > 0
          ? withTimeout((tx) =>
              tx.$queryRaw<Array<{ leadId: string; sentBy: string | null; sentByUserId: string | null }>>`
                SELECT DISTINCT ON (m."leadId")
                  m."leadId",
                  m."sentBy",
                  m."sentByUserId"
                FROM "Message" m
                JOIN "LeadCrmRow" lcr ON lcr."leadId" = m."leadId"
                WHERE m."leadId" IN (${Prisma.join(leadsMissingResponseMode)})
                  AND m.direction = 'outbound'
                  AND lcr."interestChannel" IS NOT NULL
                  AND lcr."interestRegisteredAt" IS NOT NULL
                  AND m.channel = lcr."interestChannel"
                  AND m."sentAt" > lcr."interestRegisteredAt"
                ORDER BY m."leadId", m."sentAt" ASC
              `
            )
          : Promise.resolve([]);

      const [touchRowsResult, followUpRowsResult, responseRowsResult, responseModeRowsResult] =
        await Promise.allSettled([
          touchRowsPromise,
          followUpRowsPromise,
          responseRowsPromise,
          responseModeRowsPromise,
        ]);

      if (touchRowsResult.status === "fulfilled") {
        for (const row of touchRowsResult.value) {
          stepRespondedByLeadId.set(row.leadId, Number(row.touch_count));
        }
      } else {
        console.warn("[getCrmSheetRows] Step responded query failed:", touchRowsResult.reason);
      }

      if (followUpRowsResult.status === "fulfilled") {
        for (const row of followUpRowsResult.value) {
          const list = followUpsByLeadId.get(row.leadId) ?? [];
          if (list.length < 5) {
            list.push(row.dueDate);
            followUpsByLeadId.set(row.leadId, list);
          }
        }
      } else {
        console.warn("[getCrmSheetRows] Follow-up query failed:", followUpRowsResult.reason);
      }

      if (responseRowsResult.status === "fulfilled") {
        for (const row of responseRowsResult.value) {
          responseStepCompleteByLeadId.add(row.leadId);
        }
      } else {
        console.warn("[getCrmSheetRows] Response step query failed:", responseRowsResult.reason);
      }

      if (responseModeRowsResult.status === "fulfilled") {
        for (const row of responseModeRowsResult.value) {
          responseModeByLeadId.set(row.leadId, deriveCrmResponseMode(row.sentBy, row.sentByUserId));
        }
      } else {
        console.warn("[getCrmSheetRows] Response mode query failed:", responseModeRowsResult.reason);
      }
    }

    const userIds = new Set<string>();
    for (const row of page) {
      if (row.lead.assignedToUserId) userIds.add(row.lead.assignedToUserId);
      if (row.responseSentByUserId) userIds.add(row.responseSentByUserId);
    }

    let emailMap = new Map<string, string | null>();
    if (userIds.size > 0) {
      try {
        emailMap = await getSupabaseUserEmailsByIds([...userIds]);
      } catch (error) {
        console.warn("[getCrmSheetRows] Failed to resolve setter emails:", error);
      }
    }

    const rowsMapped: CrmSheetRow[] = page.map((row) => {
      const lead = row.lead;
      const campaign =
        row.interestCampaignName ?? lead.emailCampaign?.name ?? lead.smsCampaign?.name ?? lead.campaign?.name ?? null;
      const appointmentSetter =
        lead.assignedToUserId ? emailMap.get(lead.assignedToUserId) ?? lead.assignedToUserId : null;
      const setterAssignment =
        row.responseSentByUserId ? emailMap.get(row.responseSentByUserId) ?? row.responseSentByUserId : null;

      const status = row.pipelineStatus ?? lead.status ?? null;
      const qualified =
        status === "qualified" || status === "meeting-booked"
          ? true
          : status === "unqualified" || status === "not-interested" || status === "blacklisted"
            ? false
            : null;

      const interestRegisteredAt = row.interestRegisteredAt ?? null;
      const interestChannel = row.interestChannel ?? null;
      const stepResponded =
        interestRegisteredAt && interestChannel
          ? stepRespondedByLeadId.get(row.leadId) ?? 0
          : null;
      const followUps = followUpsByLeadId.get(row.leadId) ?? [];
      const responseStepComplete =
        interestRegisteredAt && interestChannel
          ? responseStepCompleteByLeadId.has(row.leadId)
          : null;
      const derivedResponseMode = responseModeByLeadId.get(row.leadId) ?? null;
      const bookedEvidence = Boolean(lead.appointmentBookedAt || lead.ghlAppointmentId || lead.calendlyInviteeUri);
      const responseType = deriveCrmResponseType({
        sentimentTag: lead.sentimentTag ?? null,
        snoozedUntil: lead.snoozedUntil ?? null,
        bookedEvidence,
      });

      return {
        id: row.id,
        leadId: row.leadId,
        date: interestRegisteredAt,
        campaign,
        companyName: lead.companyName ?? null,
        website: lead.companyWebsite ?? null,
        firstName: lead.firstName ?? null,
        lastName: lead.lastName ?? null,
        jobTitle: lead.jobTitle ?? null,
        leadEmail: lead.email ?? null,
        leadLinkedIn: lead.linkedinUrl ?? null,
        phoneNumber: lead.phone ?? null,
        stepResponded,
        leadCategory: row.leadCategoryOverride ?? row.interestType ?? lead.sentimentTag ?? null,
        responseType,
        leadStatus: status,
        channel: interestChannel,
        leadType: row.leadType ?? null,
        applicationStatus: row.applicationStatus ?? null,
        appointmentSetter,
        setterAssignment,
        notes: row.notes ?? null,
        initialResponseDate: interestRegisteredAt,
        followUp1: followUps[0] ?? null,
        followUp2: followUps[1] ?? null,
        followUp3: followUps[2] ?? null,
        followUp4: followUps[3] ?? null,
        followUp5: followUps[4] ?? null,
        responseStepComplete,
        dateOfBooking: lead.appointmentBookedAt ?? null,
        dateOfMeeting: lead.appointmentStartAt ?? null,
        qualified,
        followUpDateRequested: lead.snoozedUntil ?? null,
        setters: appointmentSetter,
        responseMode: row.responseMode ?? derivedResponseMode ?? "UNKNOWN",
        leadScore: row.leadScoreAtInterest ?? lead.overallScore ?? null,
      };
    });

    return { success: true, data: { rows: rowsMapped, nextCursor } };
  } catch (error) {
    console.error("[getCrmSheetRows] Failed:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to fetch CRM rows" };
  }
}

type CrmAssigneeOption = { userId: string; email: string | null };

export async function getCrmAssigneeOptions(params: {
  clientId: string;
}): Promise<{ success: boolean; data?: CrmAssigneeOption[]; error?: string }> {
  try {
    const clientId = params.clientId;
    if (!clientId) return { success: false, error: "Missing clientId" };

    await requireWorkspaceCapabilities(clientId);

    const setters = await prisma.clientMember.findMany({
      where: { clientId, role: "SETTER" },
      select: { userId: true },
      orderBy: { createdAt: "asc" },
    });

    const userIds = [...new Set(setters.map((s) => s.userId))];
    if (userIds.length === 0) return { success: true, data: [] };

    const emailMap = await getSupabaseUserEmailsByIds(userIds);
    const options = userIds.map((userId) => ({
      userId,
      email: emailMap.get(userId) ?? null,
    }));

    return { success: true, data: options };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to fetch assignee options" };
  }
}

type CrmEditableField =
  | "jobTitle"
  | "leadCategory"
  | "leadStatus"
  | "leadType"
  | "applicationStatus"
  | "notes"
  | "campaign"
  | "email"
  | "phone"
  | "linkedinUrl"
  | "assignedToUserId";

function parseExpectedUpdatedAt(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export async function updateCrmSheetCell(params: {
  leadId: string;
  field: CrmEditableField;
  value: string | null;
  updateAutomation?: boolean;
  expectedUpdatedAt?: string | null;
}): Promise<{ success: boolean; error?: string; newValue?: string | null }> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: params.leadId },
      select: {
        id: true,
        clientId: true,
        updatedAt: true,
        email: true,
        phone: true,
        linkedinUrl: true,
        jobTitle: true,
        assignedToUserId: true,
        status: true,
        sentimentTag: true,
        crmRow: {
          select: {
            id: true,
            updatedAt: true,
            leadCategoryOverride: true,
            pipelineStatus: true,
            leadType: true,
            applicationStatus: true,
            notes: true,
            interestCampaignName: true,
          },
        },
      },
    });

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }

    const { capabilities } = await requireWorkspaceCapabilities(lead.clientId);
    if (capabilities.isClientPortalUser) {
      return { success: false, error: "Unauthorized" };
    }

    const updateAutomation = Boolean(params.updateAutomation);
    const value = normalizeCrmValue(params.value);
    const expectedUpdatedAt = parseExpectedUpdatedAt(params.expectedUpdatedAt ?? null);

    const assertNotStale = (current: Date | null | undefined) => {
      if (!expectedUpdatedAt) return;
      if (!current || current.getTime() !== expectedUpdatedAt.getTime()) {
        throw new Error("Row was modified by another user");
      }
    };

    switch (params.field) {
      case "jobTitle": {
        assertNotStale(lead.updatedAt);
        if (value === (lead.jobTitle ?? null)) {
          return { success: true, newValue: lead.jobTitle ?? null };
        }
        await prisma.lead.update({
          where: { id: lead.id },
          data: { jobTitle: value },
        });
        return { success: true, newValue: value };
      }
      case "email": {
        assertNotStale(lead.updatedAt);
        const normalizedEmail = value ? normalizeEmail(value) : null;
        if (normalizedEmail === (lead.email ?? null)) {
          return { success: true, newValue: lead.email ?? null };
        }
        if (normalizedEmail) {
          const duplicate = await prisma.lead.findFirst({
            where: {
              clientId: lead.clientId,
              id: { not: lead.id },
              email: { equals: normalizedEmail, mode: "insensitive" },
            },
            select: { id: true },
          });
          if (duplicate) {
            return { success: false, error: "Email is already used by another lead" };
          }
        }
        await prisma.lead.update({
          where: { id: lead.id },
          data: { email: normalizedEmail },
        });
        return { success: true, newValue: normalizedEmail };
      }
      case "phone": {
        assertNotStale(lead.updatedAt);
        const storedPhone = value ? toStoredPhone(value) : null;
        if (value && !storedPhone) {
          return { success: false, error: "Invalid phone number" };
        }
        if (storedPhone && isSamePhone(lead.phone, storedPhone)) {
          return { success: true, newValue: lead.phone ?? null };
        }
        if (storedPhone) {
          const normalizedDigits = normalizePhone(storedPhone);
          if (normalizedDigits) {
            const duplicate = await prisma.lead.findFirst({
              where: {
                clientId: lead.clientId,
                id: { not: lead.id },
                phone: { contains: normalizedDigits },
              },
              select: { id: true },
            });
            if (duplicate) {
              return { success: false, error: "Phone number is already used by another lead" };
            }
          }
        }
        await prisma.lead.update({
          where: { id: lead.id },
          data: { phone: storedPhone },
        });
        return { success: true, newValue: storedPhone };
      }
      case "linkedinUrl": {
        assertNotStale(lead.updatedAt);
        const normalizedLinkedIn = value ? normalizeLinkedInUrl(value) : null;
        if (value && !normalizedLinkedIn) {
          return { success: false, error: "Invalid LinkedIn URL" };
        }
        const existingNormalized = normalizeLinkedInUrl(lead.linkedinUrl);
        if (normalizedLinkedIn === existingNormalized) {
          return { success: true, newValue: lead.linkedinUrl ?? null };
        }
        if (normalizedLinkedIn) {
          const duplicate = await prisma.lead.findFirst({
            where: {
              clientId: lead.clientId,
              id: { not: lead.id },
              linkedinUrl: normalizedLinkedIn,
            },
            select: { id: true },
          });
          if (duplicate) {
            return { success: false, error: "LinkedIn URL is already used by another lead" };
          }
        }
        await prisma.lead.update({
          where: { id: lead.id },
          data: { linkedinUrl: normalizedLinkedIn },
        });
        return { success: true, newValue: normalizedLinkedIn };
      }
      case "assignedToUserId": {
        assertNotStale(lead.updatedAt);
        const newAssignee = value;
        if (newAssignee === (lead.assignedToUserId ?? null)) {
          return { success: true, newValue: lead.assignedToUserId ?? null };
        }
        if (newAssignee) {
          const exists = await prisma.clientMember.findFirst({
            where: { clientId: lead.clientId, userId: newAssignee },
            select: { id: true },
          });
          if (!exists) {
            return { success: false, error: "Assignee not found for workspace" };
          }
        }
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            assignedToUserId: newAssignee,
            assignedAt: newAssignee ? new Date() : null,
          },
        });
        return { success: true, newValue: newAssignee };
      }
      case "leadCategory":
      case "leadStatus":
      case "leadType":
      case "applicationStatus":
      case "notes":
      case "campaign": {
        assertNotStale(lead.crmRow?.updatedAt);
        const currentCrm = lead.crmRow;
        const crmUpdate: Record<string, unknown> = {};
        let leadUpdate: Record<string, unknown> | null = null;

        if (params.field === "leadCategory") {
          if (value !== (currentCrm?.leadCategoryOverride ?? null)) {
            crmUpdate.leadCategoryOverride = value;
          }
          if (updateAutomation) {
            const mappedSentiment = mapSentimentTagFromSheet(value);
            if (mappedSentiment && mappedSentiment !== lead.sentimentTag) {
              leadUpdate = { sentimentTag: mappedSentiment };
            }
          }
        }

        if (params.field === "leadStatus") {
          if (value !== (currentCrm?.pipelineStatus ?? null)) {
            crmUpdate.pipelineStatus = value;
          }
          if (updateAutomation) {
            const mappedStatus = mapLeadStatusFromSheet(value);
            if (mappedStatus && mappedStatus !== lead.status) {
              leadUpdate = { status: mappedStatus };
            }
          }
        }

        if (params.field === "leadType" && value !== (currentCrm?.leadType ?? null)) {
          crmUpdate.leadType = value;
        }

        if (params.field === "applicationStatus" && value !== (currentCrm?.applicationStatus ?? null)) {
          crmUpdate.applicationStatus = value;
        }

        if (params.field === "notes" && value !== (currentCrm?.notes ?? null)) {
          crmUpdate.notes = value;
        }

        if (params.field === "campaign" && value !== (currentCrm?.interestCampaignName ?? null)) {
          crmUpdate.interestCampaignName = value;
        }

        const crmNeedsUpdate = Object.keys(crmUpdate).length > 0;
        if (!crmNeedsUpdate && !leadUpdate) {
          return { success: true, newValue: value };
        }

        if (leadUpdate) {
          await prisma.$transaction(async (tx) => {
            if (crmNeedsUpdate) {
              await tx.leadCrmRow.upsert({
                where: { leadId: lead.id },
                create: { leadId: lead.id, ...crmUpdate },
                update: crmUpdate,
              });
            }
            await tx.lead.update({
              where: { id: lead.id },
              data: leadUpdate,
            });
          });
        } else if (crmNeedsUpdate) {
          await prisma.leadCrmRow.upsert({
            where: { leadId: lead.id },
            create: { leadId: lead.id, ...crmUpdate },
            update: crmUpdate,
          });
        }

        return { success: true, newValue: value };
      }
      default:
        return { success: false, error: "Unsupported field" };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update CRM cell";
    if (message === "Row was modified by another user") {
      return { success: false, error: message };
    }
    return { success: false, error: message };
  }
}
