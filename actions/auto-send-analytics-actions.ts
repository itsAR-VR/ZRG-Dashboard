"use server";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { resolveClientScope } from "@/lib/workspace-access";

function clampDays(value: unknown, fallback = 30): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof parsed !== "number") return fallback;
  return Math.max(1, Math.min(365, parsed));
}

export type AutoSendStats = {
  window: { from: string; to: string; days: number };
  campaigns: {
    total: number;
    aiAutoSend: number;
    setterManaged: number;
  };
  drafts: {
    total: number;
    evaluated: number;
    unevaluated: number;
    sendImmediate: number;
    sendDelayed: number;
    needsReview: number;
    skip: number;
    error: number;
  };
  messages: {
    aiSentEmailOutbound: number;
  };
};

export async function getAutoSendStats(
  clientId: string,
  opts?: { days?: number }
): Promise<{ success: boolean; data?: AutoSendStats; error?: string }> {
  try {
    const scope = await resolveClientScope(clientId);
    if (scope.clientIds.length === 0) {
      return {
        success: true,
        data: {
          window: { from: new Date(0).toISOString(), to: new Date(0).toISOString(), days: 0 },
          campaigns: { total: 0, aiAutoSend: 0, setterManaged: 0 },
          drafts: {
            total: 0,
            evaluated: 0,
            unevaluated: 0,
            sendImmediate: 0,
            sendDelayed: 0,
            needsReview: 0,
            skip: 0,
            error: 0,
          },
          messages: { aiSentEmailOutbound: 0 },
        },
      };
    }

    const days = clampDays(opts?.days);
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

    const [campaignRows, draftRows, aiSentRows] = await Promise.all([
      prisma.$queryRaw<Array<{ responseMode: string; count: number }>>(
        Prisma.sql`
          select
            ec."responseMode" as "responseMode",
            count(*)::int as "count"
          from "EmailCampaign" ec
          where ec."clientId" in (${Prisma.join(scope.clientIds)})
          group by ec."responseMode"
        `
      ),
      prisma.$queryRaw<Array<{ autoSendAction: string | null; count: number }>>(
        Prisma.sql`
          select
            d."autoSendAction" as "autoSendAction",
            count(*)::int as "count"
          from "AIDraft" d
          join "Lead" l on l.id = d."leadId"
          join "EmailCampaign" ec on ec.id = l."emailCampaignId"
          where l."clientId" in (${Prisma.join(scope.clientIds)})
            and ec."responseMode" = 'AI_AUTO_SEND'
            and d.channel = 'email'
            and d."createdAt" >= ${from}
            and d."createdAt" < ${to}
          group by d."autoSendAction"
        `
      ),
      prisma.$queryRaw<Array<{ count: number }>>(
        Prisma.sql`
          select count(*)::int as "count"
          from "Message" m
          join "Lead" l on l.id = m."leadId"
          join "EmailCampaign" ec on ec.id = l."emailCampaignId"
          where l."clientId" in (${Prisma.join(scope.clientIds)})
            and ec."responseMode" = 'AI_AUTO_SEND'
            and m.channel = 'email'
            and m.direction = 'outbound'
            and m.source = 'zrg'
            and m."sentBy" = 'ai'
            and m."aiDraftId" is not null
            and m."sentAt" >= ${from}
            and m."sentAt" < ${to}
        `
      ),
    ]);

    let campaignTotal = 0;
    let campaignAiAutoSend = 0;
    let campaignSetterManaged = 0;

    for (const row of campaignRows) {
      campaignTotal += row.count;
      if (row.responseMode === "AI_AUTO_SEND") campaignAiAutoSend += row.count;
      if (row.responseMode === "SETTER_MANAGED") campaignSetterManaged += row.count;
    }

    const draftCounts: Record<string, number> = {};
    let draftsTotal = 0;
    for (const row of draftRows) {
      const key = row.autoSendAction ?? "unevaluated";
      draftCounts[key] = (draftCounts[key] ?? 0) + row.count;
      draftsTotal += row.count;
    }

    const unevaluated = draftCounts.unevaluated ?? 0;
    const evaluated = Math.max(0, draftsTotal - unevaluated);

    const aiSentEmailOutbound = aiSentRows?.[0]?.count ?? 0;

    return {
      success: true,
      data: {
        window: { from: from.toISOString(), to: to.toISOString(), days },
        campaigns: {
          total: campaignTotal,
          aiAutoSend: campaignAiAutoSend,
          setterManaged: campaignSetterManaged,
        },
        drafts: {
          total: draftsTotal,
          evaluated,
          unevaluated,
          sendImmediate: draftCounts.send_immediate ?? 0,
          sendDelayed: draftCounts.send_delayed ?? 0,
          needsReview: draftCounts.needs_review ?? 0,
          skip: draftCounts.skip ?? 0,
          error: draftCounts.error ?? 0,
        },
        messages: {
          aiSentEmailOutbound,
        },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[AutoSendStats] Failed:", message, error);
    if (message === "Not authenticated" || message === "Unauthorized") {
      return { success: false, error: message };
    }
    return { success: false, error: "Failed to fetch auto-send stats" };
  }
}

