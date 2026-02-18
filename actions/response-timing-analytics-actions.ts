"use server";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  getAccessibleClientIdsForUser,
  resolveClientScope,
} from "@/lib/workspace-access";
import { getSupabaseUserEmailsByIds } from "@/lib/supabase/admin";
import { formatDurationMs } from "@/lib/business-hours";

export type ResponseTimingBookingConversionBucket = {
  booked: number;
  notBooked: number;
  pending: number;
  bookedNoTimestamp: number;
  eligible: number; // booked + notBooked (excludes pending + bookedNoTimestamp)
  bookingRate: number | null; // booked / eligible
};

export type ResponseTimingBucketRow = {
  bucket: string;
  stats: ResponseTimingBookingConversionBucket;
};

type Channel = "email" | "sms" | "linkedin";
type BookingOutcome = "BOOKED" | "NOT_BOOKED" | "PENDING" | "BOOKED_NO_TIMESTAMP";

export type ResponseTimingResponderKey = "all" | "ai" | `user:${string}`;

export type ResponseTimingResponderOption = {
  key: ResponseTimingResponderKey;
  label: string;
  eligible: number;
};

export type ResponseTimingResponderSummaryRow = {
  key: ResponseTimingResponderKey;
  label: string;
  avgResponseMs: number | null;
  avgResponseFormatted: string | null;
  stats: ResponseTimingBookingConversionBucket;
};

export type ResponseTimingAnalyticsData = {
  window: { from: string; to: string };
  attributionWindowDays: number;
  maturityBufferDays: number;
  filters: {
    channel: Channel | null;
    responder: ResponseTimingResponderKey;
  };
  responderOptions: ResponseTimingResponderOption[];
  responderSummary: ResponseTimingResponderSummaryRow[];
  responseTime: ResponseTimingBucketRow[];
  aiChosenDelay: ResponseTimingBucketRow[];
  aiDrift: ResponseTimingBucketRow[];
};

type AnalyticsAuthUser = {
  id: string;
  email: string | null;
};

async function resolveResponseTimingScope(
  clientId?: string | null,
  authUser?: AnalyticsAuthUser
): Promise<{ userId: string; clientIds: string[] }> {
  const normalizedClientId = (clientId || "").trim() || null;
  if (!authUser) {
    return resolveClientScope(normalizedClientId);
  }

  const accessibleClientIds = await getAccessibleClientIdsForUser(authUser.id, authUser.email);
  if (normalizedClientId) {
    if (!accessibleClientIds.includes(normalizedClientId)) {
      throw new Error("Unauthorized");
    }
    return { userId: authUser.id, clientIds: [normalizedClientId] };
  }

  return { userId: authUser.id, clientIds: accessibleClientIds };
}

function resolveWindow(opts?: { from?: string; to?: string }): { from: Date; to: Date } {
  const now = new Date();
  const to = opts?.to ? new Date(opts.to) : now;
  const from = opts?.from ? new Date(opts.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    return { from: new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000), to };
  }

  if (from > to) return { from: to, to: from };
  return { from, to };
}

function clampPositiveInt(value: unknown, fallback: number, max = 365): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof parsed !== "number") return fallback;
  return Math.max(1, Math.min(max, parsed));
}

function emptyBookingBucket(): ResponseTimingBookingConversionBucket {
  return {
    booked: 0,
    notBooked: 0,
    pending: 0,
    bookedNoTimestamp: 0,
    eligible: 0,
    bookingRate: null,
  };
}

function finalizeBookingBucket(bucket: ResponseTimingBookingConversionBucket): ResponseTimingBookingConversionBucket {
  const eligible = bucket.booked + bucket.notBooked;
  bucket.eligible = eligible;
  bucket.bookingRate = eligible > 0 ? bucket.booked / eligible : null;
  return bucket;
}

function bucketRowsFromOrder(order: readonly string[]): ResponseTimingBucketRow[] {
  return order.map((bucket) => ({ bucket, stats: emptyBookingBucket() }));
}

function indexRowsByBucket(rows: ResponseTimingBucketRow[]): Map<string, ResponseTimingBucketRow> {
  return new Map(rows.map((row) => [row.bucket, row]));
}

function applyOutcomeCount(bucket: ResponseTimingBookingConversionBucket, outcome: BookingOutcome, count: number): void {
  if (outcome === "BOOKED") bucket.booked += count;
  else if (outcome === "NOT_BOOKED") bucket.notBooked += count;
  else if (outcome === "PENDING") bucket.pending += count;
  else if (outcome === "BOOKED_NO_TIMESTAMP") bucket.bookedNoTimestamp += count;
}

function normalizeChannel(raw: string | null | undefined): Channel | null {
  if (!raw) return null;
  const lowered = raw.trim().toLowerCase();
  if (lowered === "email") return "email";
  if (lowered === "sms") return "sms";
  if (lowered === "linkedin") return "linkedin";
  return null;
}

function normalizeResponderKey(raw: string | null | undefined): ResponseTimingResponderKey {
  if (!raw) return "all";
  const trimmed = raw.trim();
  if (trimmed === "all") return "all";
  if (trimmed === "ai") return "ai";
  if (trimmed.startsWith("user:") && trimmed.length > "user:".length) return trimmed as ResponseTimingResponderKey;
  return "all";
}

function responderWhereClause(responder: ResponseTimingResponderKey): Prisma.Sql {
  if (responder === "all") return Prisma.sql`true`;
  if (responder === "ai") return Prisma.sql`lead_pick.responder_type = 'AI'`;
  const userId = responder.startsWith("user:") ? responder.slice("user:".length) : "";
  if (!userId) return Prisma.sql`true`;
  return Prisma.sql`lead_pick.responder_type = 'SETTER' and lead_pick.responder_user_id = ${userId}`;
}

function formatAvgMs(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return formatDurationMs(ms);
}

export async function getResponseTimingAnalytics(opts?: {
  clientId?: string | null;
  from?: string;
  to?: string;
  channel?: string | null;
  responder?: string | null;
  attributionWindowDays?: number;
  maturityBufferDays?: number;
  topRespondersLimit?: number;
  authUser?: AnalyticsAuthUser;
}): Promise<{ success: boolean; data?: ResponseTimingAnalyticsData; error?: string }> {
  try {
    const scope = await resolveResponseTimingScope(opts?.clientId ?? null, opts?.authUser);
    const { from, to } = resolveWindow({ from: opts?.from, to: opts?.to });
    const attributionWindowDays = clampPositiveInt(opts?.attributionWindowDays, 30);
    const maturityBufferDays = clampPositiveInt(opts?.maturityBufferDays, 14, 60);
    const channel = normalizeChannel(opts?.channel ?? null);
    const responder = normalizeResponderKey(opts?.responder ?? null);
    const topRespondersLimit = clampPositiveInt(opts?.topRespondersLimit, 12, 50);

    const responseTimeBuckets = ["<1min", "1-5min", "5-15min", "15-60min", "1-4hr", "4-24hr", ">24hr"] as const;
    const aiDelayBuckets = ["180-210s", "210-270s", "270-330s", "330-390s", "390-420s"] as const;
    const aiDriftBuckets = ["<10s early", "on-time (±10s)", "10-60s late", "1-5min late", ">5min late"] as const;

    const emptyData: ResponseTimingAnalyticsData = {
      window: { from: from.toISOString(), to: to.toISOString() },
      attributionWindowDays,
      maturityBufferDays,
      filters: { channel, responder },
      responderOptions: [{ key: "all", label: "All responders", eligible: 0 }],
      responderSummary: [],
      responseTime: bucketRowsFromOrder(responseTimeBuckets),
      aiChosenDelay: bucketRowsFromOrder(aiDelayBuckets),
      aiDrift: bucketRowsFromOrder(aiDriftBuckets),
    };

    if (scope.clientIds.length === 0) {
      return { success: true, data: emptyData };
    }

    const channelClause = channel ? Prisma.sql`lead_pick.channel = ${channel}` : Prisma.sql`true`;
    const responderClause = responderWhereClause(responder);

    const leadPickCte = Prisma.sql`
      with candidate as (
        select
          rte."leadId" as lead_id,
          rte.channel as channel,
          case
            when rte."setterResponseSentAt" is not null
              and (rte."aiResponseSentAt" is null or rte."setterResponseSentAt" <= rte."aiResponseSentAt")
              then 'SETTER'
            when rte."aiResponseSentAt" is not null
              then 'AI'
            else null
          end as responder_type,
          case
            when rte."setterResponseSentAt" is not null
              and (rte."aiResponseSentAt" is null or rte."setterResponseSentAt" <= rte."aiResponseSentAt")
              then rte."setterSentByUserId"
            else null
          end as responder_user_id,
          case
            when rte."setterResponseSentAt" is not null
              and (rte."aiResponseSentAt" is null or rte."setterResponseSentAt" <= rte."aiResponseSentAt")
              then rte."setterResponseSentAt"
            else rte."aiResponseSentAt"
          end as response_sent_at,
          case
            when rte."setterResponseSentAt" is not null
              and (rte."aiResponseSentAt" is null or rte."setterResponseSentAt" <= rte."aiResponseSentAt")
              then rte."setterResponseMs"
            else rte."aiResponseMs"
          end as response_ms,
          rte."aiChosenDelaySeconds" as ai_chosen_delay_seconds,
          rte."aiScheduledRunAt" as ai_scheduled_run_at,
          rte."aiResponseSentAt" as ai_response_sent_at
        from "ResponseTimingEvent" rte
        where rte."clientId" in (${Prisma.join(scope.clientIds)})
          and rte."inboundSentAt" >= (${from}::timestamp)
          and rte."inboundSentAt" < (${to}::timestamp)
          and (rte."setterResponseSentAt" is not null or rte."aiResponseSentAt" is not null)
      ),
      lead_pick as (
        select distinct on (lead_id)
          lead_id,
          channel,
          responder_type,
          responder_user_id,
          response_sent_at,
          response_ms,
          ai_chosen_delay_seconds,
          ai_scheduled_run_at,
          ai_response_sent_at
        from candidate
        where responder_type is not null
          and response_sent_at is not null
          and response_ms is not null
        order by lead_id, response_sent_at asc
      )
    `;

    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = 10000`;

      const responderAgg = await tx.$queryRaw<
        Array<{
          responderType: string;
          responderUserId: string | null;
          booked: number;
          notBooked: number;
          pending: number;
          bookedNoTimestamp: number;
          avgResponseMs: number | null;
        }>
      >(
        Prisma.sql`
          ${leadPickCte},
          channel_filtered as (
            select * from lead_pick
            where ${channelClause}
          ),
          outcomes as (
            select
              c.lead_id as lead_id,
              c.responder_type as responder_type,
              c.responder_user_id as responder_user_id,
              c.response_ms as response_ms,
              case
                when l."appointmentBookedAt" is not null
                  and l."appointmentBookedAt" > c.response_sent_at
                  and l."appointmentBookedAt" <= least((${to}::timestamp), c.response_sent_at + ((${attributionWindowDays}::int) * interval '1 day'))
                  and (l."appointmentStatus" is null or l."appointmentStatus" != 'canceled')
                  and l."appointmentCanceledAt" is null
                  then 'BOOKED'
                when l."appointmentBookedAt" is null
                  and (l."ghlAppointmentId" is not null or l."calendlyInviteeUri" is not null or l."calendlyScheduledEventUri" is not null)
                  and (l."appointmentStatus" is null or l."appointmentStatus" != 'canceled')
                  and l."appointmentCanceledAt" is null
                  then 'BOOKED_NO_TIMESTAMP'
                when c.response_sent_at >= ((${to}::timestamp) - ((${maturityBufferDays}::int) * interval '1 day'))
                  then 'PENDING'
                else 'NOT_BOOKED'
              end as outcome
            from channel_filtered c
            join "Lead" l on l.id = c.lead_id
            where l."appointmentBookedAt" is null
              or l."appointmentBookedAt" > c.response_sent_at
          )
          select
            responder_type as "responderType",
            responder_user_id as "responderUserId",
            count(*) filter (where outcome = 'BOOKED')::int as "booked",
            count(*) filter (where outcome = 'NOT_BOOKED')::int as "notBooked",
            count(*) filter (where outcome = 'PENDING')::int as "pending",
            count(*) filter (where outcome = 'BOOKED_NO_TIMESTAMP')::int as "bookedNoTimestamp",
            avg(response_ms)::float as "avgResponseMs"
          from outcomes
          group by responder_type, responder_user_id
          order by (
            count(*) filter (where outcome = 'BOOKED')
            + count(*) filter (where outcome = 'NOT_BOOKED')
          ) desc
          limit ${topRespondersLimit}
        `
      );

      const metricRows = await tx.$queryRaw<
        Array<{
          metric: string;
          bucket: string;
          outcome: string;
          count: number;
        }>
      >(
        Prisma.sql`
          ${leadPickCte},
          filtered as (
            select * from lead_pick
            where ${channelClause} and ${responderClause}
          ),
          response_time_bucketed as (
            select
              lead_id,
              response_sent_at,
              case
                when response_ms < 60000 then '<1min'
                when response_ms < 300000 then '1-5min'
                when response_ms < 900000 then '5-15min'
                when response_ms < 3600000 then '15-60min'
                when response_ms < 14400000 then '1-4hr'
                when response_ms < 86400000 then '4-24hr'
                else '>24hr'
              end as bucket
            from filtered
          ),
          response_time_outcomes as (
            select
              b.lead_id as lead_id,
              b.bucket as bucket,
              case
                when l."appointmentBookedAt" is not null
                  and l."appointmentBookedAt" > b.response_sent_at
                  and l."appointmentBookedAt" <= least((${to}::timestamp), b.response_sent_at + ((${attributionWindowDays}::int) * interval '1 day'))
                  and (l."appointmentStatus" is null or l."appointmentStatus" != 'canceled')
                  and l."appointmentCanceledAt" is null
                  then 'BOOKED'
                when l."appointmentBookedAt" is null
                  and (l."ghlAppointmentId" is not null or l."calendlyInviteeUri" is not null or l."calendlyScheduledEventUri" is not null)
                  and (l."appointmentStatus" is null or l."appointmentStatus" != 'canceled')
                  and l."appointmentCanceledAt" is null
                  then 'BOOKED_NO_TIMESTAMP'
                when b.response_sent_at >= ((${to}::timestamp) - ((${maturityBufferDays}::int) * interval '1 day'))
                  then 'PENDING'
                else 'NOT_BOOKED'
              end as outcome
            from response_time_bucketed b
            join "Lead" l on l.id = b.lead_id
            where l."appointmentBookedAt" is null
              or l."appointmentBookedAt" > b.response_sent_at
          ),
          ai_delay_bucketed as (
            select
              lead_id,
              response_sent_at,
              case
                when ai_chosen_delay_seconds >= 180 and ai_chosen_delay_seconds < 210 then '180-210s'
                when ai_chosen_delay_seconds >= 210 and ai_chosen_delay_seconds < 270 then '210-270s'
                when ai_chosen_delay_seconds >= 270 and ai_chosen_delay_seconds < 330 then '270-330s'
                when ai_chosen_delay_seconds >= 330 and ai_chosen_delay_seconds < 390 then '330-390s'
                when ai_chosen_delay_seconds >= 390 and ai_chosen_delay_seconds <= 420 then '390-420s'
                else null
              end as bucket
            from filtered
            where responder_type = 'AI'
              and ai_chosen_delay_seconds is not null
              and ai_chosen_delay_seconds >= 180
              and ai_chosen_delay_seconds <= 420
          ),
          ai_delay_outcomes as (
            select
              b.lead_id as lead_id,
              b.bucket as bucket,
              case
                when l."appointmentBookedAt" is not null
                  and l."appointmentBookedAt" > b.response_sent_at
                  and l."appointmentBookedAt" <= least((${to}::timestamp), b.response_sent_at + ((${attributionWindowDays}::int) * interval '1 day'))
                  and (l."appointmentStatus" is null or l."appointmentStatus" != 'canceled')
                  and l."appointmentCanceledAt" is null
                  then 'BOOKED'
                when l."appointmentBookedAt" is null
                  and (l."ghlAppointmentId" is not null or l."calendlyInviteeUri" is not null or l."calendlyScheduledEventUri" is not null)
                  and (l."appointmentStatus" is null or l."appointmentStatus" != 'canceled')
                  and l."appointmentCanceledAt" is null
                  then 'BOOKED_NO_TIMESTAMP'
                when b.response_sent_at >= ((${to}::timestamp) - ((${maturityBufferDays}::int) * interval '1 day'))
                  then 'PENDING'
                else 'NOT_BOOKED'
              end as outcome
            from ai_delay_bucketed b
            join "Lead" l on l.id = b.lead_id
            where b.bucket is not null
              and (l."appointmentBookedAt" is null or l."appointmentBookedAt" > b.response_sent_at)
          ),
          ai_drift_bucketed as (
            select
              lead_id,
              response_sent_at,
              (extract(epoch from (ai_response_sent_at - ai_scheduled_run_at)) * 1000)::bigint as drift_ms
            from filtered
            where responder_type = 'AI'
              and ai_response_sent_at is not null
              and ai_scheduled_run_at is not null
          ),
          ai_drift_labeled as (
            select
              lead_id,
              response_sent_at,
              case
                when drift_ms < -10000 then '<10s early'
                when drift_ms <= 10000 then 'on-time (±10s)'
                when drift_ms <= 60000 then '10-60s late'
                when drift_ms <= 300000 then '1-5min late'
                else '>5min late'
              end as bucket
            from ai_drift_bucketed
          ),
          ai_drift_outcomes as (
            select
              b.lead_id as lead_id,
              b.bucket as bucket,
              case
                when l."appointmentBookedAt" is not null
                  and l."appointmentBookedAt" > b.response_sent_at
                  and l."appointmentBookedAt" <= least((${to}::timestamp), b.response_sent_at + ((${attributionWindowDays}::int) * interval '1 day'))
                  and (l."appointmentStatus" is null or l."appointmentStatus" != 'canceled')
                  and l."appointmentCanceledAt" is null
                  then 'BOOKED'
                when l."appointmentBookedAt" is null
                  and (l."ghlAppointmentId" is not null or l."calendlyInviteeUri" is not null or l."calendlyScheduledEventUri" is not null)
                  and (l."appointmentStatus" is null or l."appointmentStatus" != 'canceled')
                  and l."appointmentCanceledAt" is null
                  then 'BOOKED_NO_TIMESTAMP'
                when b.response_sent_at >= ((${to}::timestamp) - ((${maturityBufferDays}::int) * interval '1 day'))
                  then 'PENDING'
                else 'NOT_BOOKED'
              end as outcome
            from ai_drift_labeled b
            join "Lead" l on l.id = b.lead_id
            where l."appointmentBookedAt" is null
              or l."appointmentBookedAt" > b.response_sent_at
          )
          select
            metric as metric,
            bucket as bucket,
            outcome as outcome,
            count(*)::int as count
          from (
            select 'RESPONSE_TIME' as metric, bucket, outcome from response_time_outcomes
            union all
            select 'AI_CHOSEN_DELAY' as metric, bucket, outcome from ai_delay_outcomes
            union all
            select 'AI_DRIFT' as metric, bucket, outcome from ai_drift_outcomes
          ) t
          group by metric, bucket, outcome
        `
      );

      return { responderAgg, metricRows };
    }, { timeout: 15000, maxWait: 5000 });

    const responseTime = bucketRowsFromOrder(responseTimeBuckets);
    const aiChosenDelay = bucketRowsFromOrder(aiDelayBuckets);
    const aiDrift = bucketRowsFromOrder(aiDriftBuckets);

    const responseTimeByBucket = indexRowsByBucket(responseTime);
    const aiDelayByBucket = indexRowsByBucket(aiChosenDelay);
    const aiDriftByBucket = indexRowsByBucket(aiDrift);

    for (const row of result.metricRows) {
      const outcome = row.outcome as BookingOutcome;
      if (row.metric === "RESPONSE_TIME") {
        const bucketRow = responseTimeByBucket.get(row.bucket);
        if (!bucketRow) continue;
        applyOutcomeCount(bucketRow.stats, outcome, row.count);
        continue;
      }

      if (row.metric === "AI_CHOSEN_DELAY") {
        const bucketRow = aiDelayByBucket.get(row.bucket);
        if (!bucketRow) continue;
        applyOutcomeCount(bucketRow.stats, outcome, row.count);
        continue;
      }

      if (row.metric === "AI_DRIFT") {
        const bucketRow = aiDriftByBucket.get(row.bucket);
        if (!bucketRow) continue;
        applyOutcomeCount(bucketRow.stats, outcome, row.count);
      }
    }

    responseTime.forEach((row) => finalizeBookingBucket(row.stats));
    aiChosenDelay.forEach((row) => finalizeBookingBucket(row.stats));
    aiDrift.forEach((row) => finalizeBookingBucket(row.stats));

    const setterIds = result.responderAgg
      .filter((row) => row.responderType === "SETTER" && row.responderUserId)
      .map((row) => row.responderUserId!)
      .slice(0, topRespondersLimit);
    let emailByUserId = new Map<string, string | null>();
    try {
      emailByUserId = await getSupabaseUserEmailsByIds(setterIds);
    } catch (error) {
      console.warn("[ResponseTimingAnalytics] Failed to resolve setter emails:", error);
      emailByUserId = new Map(setterIds.map((id) => [id, null]));
    }

    const responderOptions: ResponseTimingResponderOption[] = [{ key: "all", label: "All responders", eligible: 0 }];
    const responderSummary: ResponseTimingResponderSummaryRow[] = [];

    for (const row of result.responderAgg) {
      const key: ResponseTimingResponderKey =
        row.responderType === "AI"
          ? "ai"
          : row.responderUserId
            ? (`user:${row.responderUserId}` as const)
            : ("user:unknown" as const);
      const label =
        row.responderType === "AI"
          ? "AI"
          : row.responderUserId
            ? emailByUserId.get(row.responderUserId) ?? row.responderUserId
            : "Unknown setter";

      const bucket = emptyBookingBucket();
      bucket.booked = row.booked;
      bucket.notBooked = row.notBooked;
      bucket.pending = row.pending;
      bucket.bookedNoTimestamp = row.bookedNoTimestamp;
      finalizeBookingBucket(bucket);

      const avgMs = row.avgResponseMs != null && Number.isFinite(row.avgResponseMs) ? row.avgResponseMs : null;

      responderSummary.push({
        key,
        label,
        avgResponseMs: avgMs,
        avgResponseFormatted: avgMs != null ? formatAvgMs(avgMs) : null,
        stats: bucket,
      });

      responderOptions.push({ key, label, eligible: bucket.eligible });
    }

    responderOptions[0].eligible = responderSummary.reduce((acc, row) => acc + row.stats.eligible, 0);
    responderOptions.sort((a, b) => {
      if (a.key === "all") return -1;
      if (b.key === "all") return 1;
      if (a.key === "ai") return -1;
      if (b.key === "ai") return 1;
      return b.eligible - a.eligible;
    });

    return {
      success: true,
      data: {
        window: { from: from.toISOString(), to: to.toISOString() },
        attributionWindowDays,
        maturityBufferDays,
        filters: { channel, responder },
        responderOptions,
        responderSummary,
        responseTime,
        aiChosenDelay,
        aiDrift,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[ResponseTimingAnalytics] Failed:", message, error);
    if (message === "Not authenticated" || message === "Unauthorized") {
      return { success: false, error: message };
    }
    return { success: false, error: "Failed to fetch response timing analytics" };
  }
}
