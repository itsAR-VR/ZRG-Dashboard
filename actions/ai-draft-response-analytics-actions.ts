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
