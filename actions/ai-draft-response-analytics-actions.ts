"use server";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { resolveClientScope } from "@/lib/workspace-access";

export type AiDraftResponseOutcomeStats = {
  window: { from: string; to: string };
  byChannel: {
    email: { AUTO_SENT: number; APPROVED: number; EDITED: number; total: number };
    sms: { AUTO_SENT: number; APPROVED: number; EDITED: number; total: number };
    linkedin: { AUTO_SENT: number; APPROVED: number; EDITED: number; total: number };
  };
  total: { AUTO_SENT: number; APPROVED: number; EDITED: number; tracked: number };
};

export type AiDraftBookingConversionBucket = {
  booked: number;
  notBooked: number;
  pending: number;
  bookedNoTimestamp: number;
  eligible: number; // booked + notBooked (excludes pending + bookedNoTimestamp)
  bookingRate: number | null; // booked / eligible
};

export type AiDraftBookingConversionStats = {
  window: { from: string; to: string };
  attributionWindowDays: number;
  maturityBufferDays: number;
  byChannel: {
    email: Record<"AUTO_SENT" | "APPROVED" | "EDITED", AiDraftBookingConversionBucket>;
    sms: Record<"AUTO_SENT" | "APPROVED" | "EDITED", AiDraftBookingConversionBucket>;
    linkedin: Record<"AUTO_SENT" | "APPROVED" | "EDITED", AiDraftBookingConversionBucket>;
  };
  total: Record<"AUTO_SENT" | "APPROVED" | "EDITED", AiDraftBookingConversionBucket> & {
    all: AiDraftBookingConversionBucket;
  };
};

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

type Outcome = "AUTO_SENT" | "APPROVED" | "EDITED";
type Channel = "email" | "sms" | "linkedin";

function emptyCounts() {
  return { AUTO_SENT: 0, APPROVED: 0, EDITED: 0, total: 0 };
}

type BookingOutcome = "BOOKED" | "NOT_BOOKED" | "PENDING" | "BOOKED_NO_TIMESTAMP";

function emptyBookingBucket(): AiDraftBookingConversionBucket {
  return {
    booked: 0,
    notBooked: 0,
    pending: 0,
    bookedNoTimestamp: 0,
    eligible: 0,
    bookingRate: null,
  };
}

function finalizeBookingBucket(bucket: AiDraftBookingConversionBucket): AiDraftBookingConversionBucket {
  const eligible = bucket.booked + bucket.notBooked;
  bucket.eligible = eligible;
  bucket.bookingRate = eligible > 0 ? bucket.booked / eligible : null;
  return bucket;
}

export async function getAiDraftResponseOutcomeStats(opts?: {
  clientId?: string | null;
  from?: string;
  to?: string;
}): Promise<{ success: boolean; data?: AiDraftResponseOutcomeStats; error?: string }> {
  try {
    const scope = await resolveClientScope(opts?.clientId ?? null);
    const { from, to } = resolveWindow({ from: opts?.from, to: opts?.to });

    if (scope.clientIds.length === 0) {
      const empty = emptyCounts();
      return {
        success: true,
        data: {
          window: { from: from.toISOString(), to: to.toISOString() },
          byChannel: { email: empty, sms: empty, linkedin: empty },
          total: { AUTO_SENT: 0, APPROVED: 0, EDITED: 0, tracked: 0 },
        },
      };
    }

    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = 10000`;

      return await tx.$queryRaw<Array<{ channel: string; responseDisposition: string; count: number }>>(
        Prisma.sql`
          with draft_send_time as (
            select
              d.id as "aiDraftId",
              min(m."sentAt") as "sentAt"
            from "AIDraft" d
            join "Lead" l on l.id = d."leadId"
            join "Message" m on m."aiDraftId" = d.id
            where l."clientId" in (${Prisma.join(scope.clientIds)})
              and m.direction = 'outbound'
            group by d.id
          )
          select
            d.channel as "channel",
            d."responseDisposition" as "responseDisposition",
            count(distinct d.id)::int as "count"
          from "AIDraft" d
          join "Lead" l on l.id = d."leadId"
          join draft_send_time dst on dst."aiDraftId" = d.id
          left join "EmailCampaign" ec on ec.id = l."emailCampaignId"
          where l."clientId" in (${Prisma.join(scope.clientIds)})
            and d."responseDisposition" is not null
            -- Intentionally excludes drafts without outbound Messages: no stable send-time anchor.
            and dst."sentAt" >= ${from}
            and dst."sentAt" < ${to}
            and (d.channel != 'email' or ec."responseMode" = 'AI_AUTO_SEND')
          group by d.channel, d."responseDisposition"
        `
      );
    });

    const byChannel: Record<Channel, ReturnType<typeof emptyCounts>> = {
      email: emptyCounts(),
      sms: emptyCounts(),
      linkedin: emptyCounts(),
    };
    const total: Record<Outcome, number> = { AUTO_SENT: 0, APPROVED: 0, EDITED: 0 };

    for (const row of rows) {
      const channel = row.channel as Channel;
      if (!(channel in byChannel)) continue;

      const outcome = row.responseDisposition as Outcome;
      if (outcome !== "AUTO_SENT" && outcome !== "APPROVED" && outcome !== "EDITED") continue;

      byChannel[channel][outcome] += row.count;
      byChannel[channel].total += row.count;
      total[outcome] += row.count;
    }

    return {
      success: true,
      data: {
        window: { from: from.toISOString(), to: to.toISOString() },
        byChannel,
        total: {
          AUTO_SENT: total.AUTO_SENT,
          APPROVED: total.APPROVED,
          EDITED: total.EDITED,
          tracked: total.AUTO_SENT + total.APPROVED + total.EDITED,
        },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[AiDraftOutcomeStats] Failed:", message, error);
    if (message === "Not authenticated" || message === "Unauthorized") {
      return { success: false, error: message };
    }
    return { success: false, error: "Failed to fetch AI draft outcomes" };
  }
}

function clampPositiveInt(value: unknown, fallback: number, max = 365): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof parsed !== "number") return fallback;
  return Math.max(1, Math.min(max, parsed));
}

export async function getAiDraftBookingConversionStats(opts?: {
  clientId?: string | null;
  from?: string;
  to?: string;
  attributionWindowDays?: number;
  maturityBufferDays?: number;
}): Promise<{ success: boolean; data?: AiDraftBookingConversionStats; error?: string }> {
  try {
    const scope = await resolveClientScope(opts?.clientId ?? null);
    const { from, to } = resolveWindow({ from: opts?.from, to: opts?.to });
    const attributionWindowDays = clampPositiveInt(opts?.attributionWindowDays, 30);
    const maturityBufferDays = clampPositiveInt(opts?.maturityBufferDays, 7, 60);

    const emptyByDisposition = (): Record<Outcome, AiDraftBookingConversionBucket> => ({
      AUTO_SENT: emptyBookingBucket(),
      APPROVED: emptyBookingBucket(),
      EDITED: emptyBookingBucket(),
    });

    if (scope.clientIds.length === 0) {
      return {
        success: true,
        data: {
          window: { from: from.toISOString(), to: to.toISOString() },
          attributionWindowDays,
          maturityBufferDays,
          byChannel: { email: emptyByDisposition(), sms: emptyByDisposition(), linkedin: emptyByDisposition() },
          total: { ...emptyByDisposition(), all: emptyBookingBucket() },
        },
      };
    }

    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = 10000`;

      return await tx.$queryRaw<
        Array<{
          channel: string;
          responseDisposition: string;
          outcome: string;
          count: number;
        }>
      >(
        Prisma.sql`
          with draft_send_time as (
            select
              d.id as "aiDraftId",
              min(m."sentAt") as "sentAt"
            from "AIDraft" d
            join "Lead" l on l.id = d."leadId"
            join "Message" m on m."aiDraftId" = d.id
            where l."clientId" in (${Prisma.join(scope.clientIds)})
              and m.direction = 'outbound'
            group by d.id
          ),
          lead_bucket as (
            select
              l.id as lead_id,
              d.channel as channel,
              d."responseDisposition" as response_disposition,
              max(dst."sentAt") as sent_at
            from "AIDraft" d
            join "Lead" l on l.id = d."leadId"
            join draft_send_time dst on dst."aiDraftId" = d.id
            left join "EmailCampaign" ec on ec.id = l."emailCampaignId"
            where l."clientId" in (${Prisma.join(scope.clientIds)})
              and d."responseDisposition" is not null
              -- Intentionally excludes drafts without outbound Messages: no stable send-time anchor.
              and dst."sentAt" >= ${from}
              and dst."sentAt" < ${to}
              and (d.channel != 'email' or ec."responseMode" = 'AI_AUTO_SEND')
            group by l.id, d.channel, d."responseDisposition"
          ),
          bucket_outcomes as (
            select
              b.lead_id as lead_id,
              b.channel as channel,
              b.response_disposition as response_disposition,
              case
                when l."appointmentBookedAt" is not null
                  and l."appointmentBookedAt" > b.sent_at
                  and l."appointmentBookedAt" <= least(${to}, b.sent_at + (${attributionWindowDays} * interval '1 day'))
                  and (l."appointmentStatus" is null or l."appointmentStatus" != 'canceled')
                  and l."appointmentCanceledAt" is null
                  then 'BOOKED'
                when l."appointmentBookedAt" is null
                  and (l."ghlAppointmentId" is not null or l."calendlyInviteeUri" is not null or l."calendlyScheduledEventUri" is not null)
                  and (l."appointmentStatus" is null or l."appointmentStatus" != 'canceled')
                  and l."appointmentCanceledAt" is null
                  then 'BOOKED_NO_TIMESTAMP'
                when b.sent_at >= (${to} - (${maturityBufferDays} * interval '1 day'))
                  then 'PENDING'
                else 'NOT_BOOKED'
              end as outcome
            from lead_bucket b
            join "Lead" l on l.id = b.lead_id
            where
              l."appointmentBookedAt" is null
              or l."appointmentBookedAt" > b.sent_at
          )
          select
            channel as "channel",
            response_disposition as "responseDisposition",
            outcome as "outcome",
            count(distinct lead_id)::int as "count"
          from bucket_outcomes
          group by channel, response_disposition, outcome
        `
      );
    });

    const byChannel: Record<Channel, Record<Outcome, AiDraftBookingConversionBucket>> = {
      email: emptyByDisposition(),
      sms: emptyByDisposition(),
      linkedin: emptyByDisposition(),
    };
    const total: Record<Outcome, AiDraftBookingConversionBucket> = emptyByDisposition();
    const all = emptyBookingBucket();

    for (const row of rows) {
      const channel = row.channel as Channel;
      if (!(channel in byChannel)) continue;

      const disposition = row.responseDisposition as Outcome;
      if (disposition !== "AUTO_SENT" && disposition !== "APPROVED" && disposition !== "EDITED") continue;

      const outcome = row.outcome as BookingOutcome | null;
      if (!outcome) continue;

      const bucket = byChannel[channel][disposition];
      const totalBucket = total[disposition];

      if (outcome === "BOOKED") {
        bucket.booked += row.count;
        totalBucket.booked += row.count;
        all.booked += row.count;
      } else if (outcome === "NOT_BOOKED") {
        bucket.notBooked += row.count;
        totalBucket.notBooked += row.count;
        all.notBooked += row.count;
      } else if (outcome === "PENDING") {
        bucket.pending += row.count;
        totalBucket.pending += row.count;
        all.pending += row.count;
      } else if (outcome === "BOOKED_NO_TIMESTAMP") {
        bucket.bookedNoTimestamp += row.count;
        totalBucket.bookedNoTimestamp += row.count;
        all.bookedNoTimestamp += row.count;
      }
    }

    (Object.keys(byChannel) as Channel[]).forEach((channel) => {
      (Object.keys(byChannel[channel]) as Outcome[]).forEach((disposition) => {
        finalizeBookingBucket(byChannel[channel][disposition]);
      });
    });
    (Object.keys(total) as Outcome[]).forEach((disposition) => {
      finalizeBookingBucket(total[disposition]);
    });
    finalizeBookingBucket(all);

    return {
      success: true,
      data: {
        window: { from: from.toISOString(), to: to.toISOString() },
        attributionWindowDays,
        maturityBufferDays,
        byChannel,
        total: { ...total, all },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[AiDraftBookingConversionStats] Failed:", message, error);
    if (message === "Not authenticated" || message === "Unauthorized") {
      return { success: false, error: message };
    }
    return { success: false, error: "Failed to fetch AI draft booking conversion stats" };
  }
}
