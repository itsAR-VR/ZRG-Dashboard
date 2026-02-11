import "server-only";

import { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { computeChosenDelaySeconds } from "@/lib/background-jobs/delayed-auto-send";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getLookbackDays(): number {
  return Math.max(1, parsePositiveInt(process.env.RESPONSE_TIMING_LOOKBACK_DAYS, 90));
}

function getBatchSize(): number {
  const parsed = Number.parseInt(process.env.RESPONSE_TIMING_BATCH_SIZE || "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 200;
  return Math.max(0, Math.min(5000, parsed));
}

function getMaxMs(): number {
  const parsed = Number.parseInt(process.env.RESPONSE_TIMING_MAX_MS || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 15_000;
  return Math.max(250, Math.min(120_000, parsed));
}

export type ResponseTimingProcessorResult = {
  inserted: number;
  updatedSetter: number;
  updatedAi: number;
  durationMs: number;
  exhausted: boolean;
  scanFromIso: string;
  scanToIso: string;
};

type AiCandidateRow = {
  responseTimingEventId: string;
  inboundMessageId: string;
  inboundSentAt: Date;
  channel: string;
  leadId: string;
  clientId: string;
  campaignResponseMode: string | null;
  delayMinSeconds: number | null;
  delayMaxSeconds: number | null;
  draftId: string | null;
  aiMessageId: string | null;
  aiMessageSentAt: Date | null;
  jobId: string | null;
  jobRunAt: Date | null;
  jobStartedAt: Date | null;
  jobFinishedAt: Date | null;
};

function computeDelaySecondsFromDates(start: Date, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
}

/**
 * Populates ResponseTimingEvent rows from system-of-record tables.
 * Intended to run in cron with small, bounded batches.
 */
export async function processResponseTimingEvents(opts?: {
  lookbackDays?: number;
  batchSize?: number;
  maxMs?: number;
  prisma?: PrismaClient;
  dryRun?: boolean;
}): Promise<ResponseTimingProcessorResult> {
  const startedAtMs = Date.now();
  const maxMs = opts?.maxMs ?? getMaxMs();
  const batchSize = opts?.batchSize ?? getBatchSize();
  const lookbackDays = opts?.lookbackDays ?? getLookbackDays();

  const now = new Date();
  const scanTo = now;
  const scanFrom = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  if (batchSize <= 0) {
    return {
      inserted: 0,
      updatedSetter: 0,
      updatedAi: 0,
      durationMs: Date.now() - startedAtMs,
      exhausted: false,
      scanFromIso: scanFrom.toISOString(),
      scanToIso: scanTo.toISOString(),
    };
  }

  const db = opts?.prisma ?? prisma;
  const dryRun = opts?.dryRun === true;

  const res = await db.$transaction(async (tx) => {
    // Keep the transaction bounded; this is cron-safe work.
    const statementTimeoutMs = Math.max(5000, Math.min(30_000, maxMs + 2500));
    await tx.$executeRaw`SET LOCAL statement_timeout = ${statementTimeoutMs}`;

    let inserted = 0;
    let updatedSetter = 0;
    let updatedAi = 0;
    let exhausted = false;

    // ---------------------------------------------------------------------
    // 1) Insert missing anchors (inbound messages where the next message in the
    // same lead+channel thread is outbound).
    // ---------------------------------------------------------------------
    if (Date.now() - startedAtMs < maxMs - 250) {
      if (dryRun) {
        const rows = await tx.$queryRaw<Array<{ inboundMessageId: string }>>(
          Prisma.sql`
            select
              m.id as "inboundMessageId"
            from "Message" m
            join "Lead" l on l.id = m."leadId"
            join lateral (
              select m2.direction
              from "Message" m2
              where m2."leadId" = m."leadId"
                and m2.channel = m.channel
                and m2."sentAt" > m."sentAt"
              order by m2."sentAt" asc
              limit 1
            ) next_msg on true
            where m.direction = 'inbound'
              and m."sentAt" >= ${scanFrom}
              and m."sentAt" < ${scanTo}
              and next_msg.direction = 'outbound'
              and not exists (
                select 1
                from "ResponseTimingEvent" rte
                where rte."inboundMessageId" = m.id
              )
            order by m."sentAt" desc
            limit ${batchSize}
          `
        );
        inserted = rows.length;
      } else {
        const insertedRows = await tx.$queryRaw<Array<{ inboundMessageId: string }>>(
          Prisma.sql`
            insert into "ResponseTimingEvent" (
              "clientId",
              "leadId",
              "channel",
              "inboundMessageId",
              "inboundSentAt"
            )
            select
              l."clientId" as "clientId",
              m."leadId" as "leadId",
              m.channel as "channel",
              m.id as "inboundMessageId",
              m."sentAt" as "inboundSentAt"
            from "Message" m
            join "Lead" l on l.id = m."leadId"
            join lateral (
              select m2.direction
              from "Message" m2
              where m2."leadId" = m."leadId"
                and m2.channel = m.channel
                and m2."sentAt" > m."sentAt"
              order by m2."sentAt" asc
              limit 1
            ) next_msg on true
            where m.direction = 'inbound'
              and m."sentAt" >= ${scanFrom}
              and m."sentAt" < ${scanTo}
              and next_msg.direction = 'outbound'
              and not exists (
                select 1
                from "ResponseTimingEvent" rte
                where rte."inboundMessageId" = m.id
              )
            order by m."sentAt" desc
            limit ${batchSize}
            on conflict ("inboundMessageId") do nothing
            returning "inboundMessageId"
          `
        );

        inserted = insertedRows.length;
      }
    } else {
      exhausted = true;
    }

    // ---------------------------------------------------------------------
    // 2) Update setter response fields for recent anchors
    // ---------------------------------------------------------------------
    if (!exhausted && Date.now() - startedAtMs < maxMs - 250) {
      const updatedRows = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          with candidates as (
            select
              rte.id as id,
              next_m.id as next_message_id,
              next_m."sentAt" as next_sent_at,
              next_m."sentByUserId" as next_sent_by_user_id,
              (extract(epoch from (next_m."sentAt" - rte."inboundSentAt")) * 1000)::int as response_ms
            from "ResponseTimingEvent" rte
            join lateral (
              select
                m2.id,
                m2."sentAt",
                m2.direction,
                m2."sentBy",
                m2."sentByUserId"
              from "Message" m2
              where m2."leadId" = rte."leadId"
                and m2.channel = rte.channel
                and m2."sentAt" > rte."inboundSentAt"
              order by m2."sentAt" asc
              limit 1
            ) next_m on true
            where rte."inboundSentAt" >= ${scanFrom}
              and rte."inboundSentAt" < ${scanTo}
              and next_m.direction = 'outbound'
              and next_m."sentBy" = 'setter'
              and next_m."sentByUserId" is not null
              and (
                rte."setterResponseMessageId" is null
                or rte."setterResponseMessageId" <> next_m.id
              )
            order by rte."inboundSentAt" desc
            limit ${batchSize}
          )
          ${
            dryRun
              ? Prisma.sql`select id from candidates`
              : Prisma.sql`
                  update "ResponseTimingEvent" rte
                  set
                    "setterResponseMessageId" = c.next_message_id,
                    "setterResponseSentAt" = c.next_sent_at,
                    "setterSentByUserId" = c.next_sent_by_user_id,
                    "setterResponseMs" = c.response_ms,
                    "updatedAt" = now()
                  from candidates c
                  where rte.id = c.id
                  returning rte.id as id
                `
          }
        `
      );

      updatedSetter = updatedRows.length;
    } else if (!exhausted) {
      exhausted = true;
    }

    // ---------------------------------------------------------------------
    // 3) Update AI response + delay attribution for recent anchors
    // ---------------------------------------------------------------------
    if (!exhausted && Date.now() - startedAtMs < maxMs - 250) {
      const candidates = await tx.$queryRaw<AiCandidateRow[]>(
        Prisma.sql`
          select
            rte.id as "responseTimingEventId",
            rte."inboundMessageId" as "inboundMessageId",
            rte."inboundSentAt" as "inboundSentAt",
            rte.channel as "channel",
            rte."leadId" as "leadId",
            rte."clientId" as "clientId",
            ec."responseMode" as "campaignResponseMode",
            case when ec."responseMode" = 'AI_AUTO_SEND' then ec."autoSendDelayMinSeconds" else null end as "delayMinSeconds",
            case when ec."responseMode" = 'AI_AUTO_SEND' then ec."autoSendDelayMaxSeconds" else null end as "delayMaxSeconds",
            d.id as "draftId",
            ai_msg.id as "aiMessageId",
            ai_msg."sentAt" as "aiMessageSentAt",
            job.id as "jobId",
            job."runAt" as "jobRunAt",
            job."startedAt" as "jobStartedAt",
            job."finishedAt" as "jobFinishedAt"
          from "ResponseTimingEvent" rte
          join "Lead" l on l.id = rte."leadId"
          left join "EmailCampaign" ec on ec.id = l."emailCampaignId"
          left join "AIDraft" d on d."triggerMessageId" = rte."inboundMessageId" and d.channel = rte.channel
          left join lateral (
            select m2.id, m2."sentAt"
            from "Message" m2
            where d.id is not null
              and m2."aiDraftId" = d.id
              and m2.direction = 'outbound'
              and m2."sentBy" = 'ai'
            order by m2."sentAt" asc
            limit 1
          ) ai_msg on true
          left join "BackgroundJob" job on
            job.type = 'AI_AUTO_SEND_DELAYED'
            and job."messageId" = rte."inboundMessageId"
            and job."draftId" = d.id
          where rte."inboundSentAt" >= ${scanFrom}
            and rte."inboundSentAt" < ${scanTo}
            and (
              (rte."aiDraftId" is null and d.id is not null)
              or (rte."aiResponseMessageId" is null and ai_msg.id is not null)
              or (rte."aiResponseSentAt" is null and ai_msg."sentAt" is not null)
              or (rte."aiResponseMs" is null and ai_msg."sentAt" is not null)
              or (rte."aiActualDelaySeconds" is null and ai_msg."sentAt" is not null)
              or (rte."aiDelayMinSeconds" is null and ec."responseMode" = 'AI_AUTO_SEND')
              or (rte."aiDelayMaxSeconds" is null and ec."responseMode" = 'AI_AUTO_SEND')
              or (rte."aiChosenDelaySeconds" is null and ec."responseMode" = 'AI_AUTO_SEND')
              or (rte."aiBackgroundJobId" is null and job.id is not null)
              or (rte."aiScheduledRunAt" is null and job."runAt" is not null)
              or (rte."aiJobStartedAt" is null and job."startedAt" is not null)
              or (rte."aiJobFinishedAt" is null and job."finishedAt" is not null)
            )
          order by rte."inboundSentAt" desc
          limit ${batchSize}
        `
      );

      if (dryRun) {
        updatedAi = candidates.length;
        return { inserted, updatedSetter, updatedAi, exhausted };
      }

      for (const row of candidates) {
        if (Date.now() - startedAtMs > maxMs - 250) {
          exhausted = true;
          break;
        }

        const delayMinSeconds = row.delayMinSeconds;
        const delayMaxSeconds = row.delayMaxSeconds;
        const chosenDelaySeconds =
          delayMinSeconds != null && delayMaxSeconds != null
            ? computeChosenDelaySeconds(row.inboundMessageId, delayMinSeconds, delayMaxSeconds)
            : null;

        const aiActualDelaySeconds =
          row.aiMessageSentAt != null ? computeDelaySecondsFromDates(row.inboundSentAt, row.aiMessageSentAt) : null;
        const aiResponseMs =
          row.aiMessageSentAt != null ? Math.max(0, row.aiMessageSentAt.getTime() - row.inboundSentAt.getTime()) : null;

        const shouldUpdate =
          row.draftId != null ||
          row.aiMessageId != null ||
          row.jobId != null ||
          chosenDelaySeconds != null ||
          aiActualDelaySeconds != null;

        if (!shouldUpdate) continue;

        await tx.responseTimingEvent.update({
          where: { id: row.responseTimingEventId },
          data: {
            aiDraftId: row.draftId,
            aiResponseMessageId: row.aiMessageId,
            aiResponseSentAt: row.aiMessageSentAt,
            aiResponseMs,
            aiDelayMinSeconds: delayMinSeconds,
            aiDelayMaxSeconds: delayMaxSeconds,
            aiChosenDelaySeconds: chosenDelaySeconds,
            aiActualDelaySeconds,
            aiScheduledRunAt: row.jobRunAt,
            aiBackgroundJobId: row.jobId,
            aiJobStartedAt: row.jobStartedAt,
            aiJobFinishedAt: row.jobFinishedAt,
          },
        });

        updatedAi += 1;
      }
    } else if (!exhausted) {
      exhausted = true;
    }

    return { inserted, updatedSetter, updatedAi, exhausted };
  });

  return {
    ...res,
    durationMs: Date.now() - startedAtMs,
    scanFromIso: scanFrom.toISOString(),
    scanToIso: scanTo.toISOString(),
  };
}
