import "server-only";

import { Prisma } from "@prisma/client";

import { ATTENTION_SENTIMENT_TAGS } from "@/lib/inbox-counts-constants";
import { GLOBAL_SCOPE_USER_ID } from "@/lib/inbox-counts";
import { prisma } from "@/lib/prisma";
import { redisIncr } from "@/lib/redis";

type RecomputeCountRow = {
  totalNonBlacklisted: number;
  blacklisted: number;
  total: number;
  needsRepair: number;
  allResponses: number;
  requiresAttention: number;
  previouslyRequiredAttention: number;
  aiSent: number;
  aiReview: number;
};

type RecomputeSetterCountRow = RecomputeCountRow & {
  scopeUserId: string;
};

function toStoredCounts(row: RecomputeCountRow) {
  const awaitingReply = Math.max(0, row.totalNonBlacklisted - row.requiresAttention);
  return {
    allResponses: row.allResponses,
    requiresAttention: row.requiresAttention,
    previouslyRequiredAttention: row.previouslyRequiredAttention,
    totalNonBlacklisted: row.totalNonBlacklisted,
    awaitingReply,
    needsRepair: row.needsRepair,
    aiSent: row.aiSent,
    aiReview: row.aiReview,
    total: row.total,
    computedAt: new Date(),
  };
}

export async function recomputeInboxCounts(clientId: string): Promise<void> {
  const normalizedClientId = clientId.trim();
  if (!normalizedClientId) return;

  const now = new Date();
  const attentionTags = ATTENTION_SENTIMENT_TAGS as unknown as string[];

  const [globalRows, setterRows] = await Promise.all([
    prisma.$queryRaw<RecomputeCountRow[]>(Prisma.sql`
      select
        count(*) filter (
          where l."status" not in ('blacklisted', 'unqualified')
        )::int as "totalNonBlacklisted",
        count(*) filter (
          where l."status" = 'blacklisted'
        )::int as "blacklisted",
        count(*)::int as "total",
        count(*) filter (
          where l."status" = 'needs_repair'
        )::int as "needsRepair",
        count(*) filter (
          where l."lastInboundAt" is not null
            and l."lastInboundAt" > coalesce(l."lastZrgOutboundAt", l."lastOutboundAt", to_timestamp(0))
        )::int as "allResponses",
        count(*) filter (
          where l."lastInboundAt" is not null
            and l."sentimentTag" in (${Prisma.join(attentionTags)})
            and l."status" not in ('blacklisted', 'unqualified')
            and l."lastInboundAt" > coalesce(l."lastZrgOutboundAt", l."lastOutboundAt", to_timestamp(0))
        )::int as "requiresAttention",
        count(*) filter (
          where l."lastInboundAt" is not null
            and l."sentimentTag" in (${Prisma.join(attentionTags)})
            and l."status" not in ('blacklisted', 'unqualified')
            and coalesce(l."lastZrgOutboundAt", l."lastOutboundAt", to_timestamp(0)) >= l."lastInboundAt"
        )::int as "previouslyRequiredAttention",
        count(*) filter (
          where exists (
            select 1
            from "AIDraft" d
            where d."leadId" = l.id
              and d.status = 'pending'
              and d."autoSendAction" = 'needs_review'
          )
        )::int as "aiReview",
        count(*) filter (
          where exists (
            select 1
            from "Message" m
            where m."leadId" = l.id
              and m.channel = 'email'
              and m.direction = 'outbound'
              and m.source = 'zrg'
              and m."sentBy" = 'ai'
              and m."aiDraftId" is not null
          )
        )::int as "aiSent"
      from "Lead" l
      where l."clientId" = ${normalizedClientId}
        and (l."snoozedUntil" is null or l."snoozedUntil" <= ${now})
    `),
    prisma.$queryRaw<RecomputeSetterCountRow[]>(Prisma.sql`
      select
        l."assignedToUserId" as "scopeUserId",
        count(*) filter (
          where l."status" not in ('blacklisted', 'unqualified')
        )::int as "totalNonBlacklisted",
        count(*) filter (
          where l."status" = 'blacklisted'
        )::int as "blacklisted",
        count(*)::int as "total",
        count(*) filter (
          where l."status" = 'needs_repair'
        )::int as "needsRepair",
        count(*) filter (
          where l."lastInboundAt" is not null
            and l."lastInboundAt" > coalesce(l."lastZrgOutboundAt", l."lastOutboundAt", to_timestamp(0))
        )::int as "allResponses",
        count(*) filter (
          where l."lastInboundAt" is not null
            and l."sentimentTag" in (${Prisma.join(attentionTags)})
            and l."status" not in ('blacklisted', 'unqualified')
            and l."lastInboundAt" > coalesce(l."lastZrgOutboundAt", l."lastOutboundAt", to_timestamp(0))
        )::int as "requiresAttention",
        count(*) filter (
          where l."lastInboundAt" is not null
            and l."sentimentTag" in (${Prisma.join(attentionTags)})
            and l."status" not in ('blacklisted', 'unqualified')
            and coalesce(l."lastZrgOutboundAt", l."lastOutboundAt", to_timestamp(0)) >= l."lastInboundAt"
        )::int as "previouslyRequiredAttention",
        count(*) filter (
          where exists (
            select 1
            from "AIDraft" d
            where d."leadId" = l.id
              and d.status = 'pending'
              and d."autoSendAction" = 'needs_review'
          )
        )::int as "aiReview",
        count(*) filter (
          where exists (
            select 1
            from "Message" m
            where m."leadId" = l.id
              and m.channel = 'email'
              and m.direction = 'outbound'
              and m.source = 'zrg'
              and m."sentBy" = 'ai'
              and m."aiDraftId" is not null
          )
        )::int as "aiSent"
      from "Lead" l
      where l."clientId" = ${normalizedClientId}
        and l."assignedToUserId" is not null
        and (l."snoozedUntil" is null or l."snoozedUntil" <= ${now})
      group by l."assignedToUserId"
    `),
  ]);

  const global = globalRows[0] ?? {
    totalNonBlacklisted: 0,
    blacklisted: 0,
    total: 0,
    needsRepair: 0,
    allResponses: 0,
    requiresAttention: 0,
    previouslyRequiredAttention: 0,
    aiSent: 0,
    aiReview: 0,
  };

  const globalData = toStoredCounts(global);
  const setterRowsNormalized = setterRows
    .filter((row) => typeof row.scopeUserId === "string" && row.scopeUserId.trim().length > 0)
    .map((row) => ({
      scopeUserId: row.scopeUserId.trim(),
      data: toStoredCounts(row),
    }));

  await prisma.$transaction(async (tx) => {
    await tx.inboxCounts.upsert({
      where: {
        clientId_isGlobal_scopeUserId: {
          clientId: normalizedClientId,
          isGlobal: true,
          scopeUserId: GLOBAL_SCOPE_USER_ID,
        },
      },
      create: {
        clientId: normalizedClientId,
        isGlobal: true,
        scopeUserId: GLOBAL_SCOPE_USER_ID,
        ...globalData,
      },
      update: globalData,
      select: { id: true },
    });

    for (const row of setterRowsNormalized) {
      await tx.inboxCounts.upsert({
        where: {
          clientId_isGlobal_scopeUserId: {
            clientId: normalizedClientId,
            isGlobal: false,
            scopeUserId: row.scopeUserId,
          },
        },
        create: {
          clientId: normalizedClientId,
          isGlobal: false,
          scopeUserId: row.scopeUserId,
          ...row.data,
        },
        update: row.data,
        select: { id: true },
      });
    }

    const setterScopeIds = setterRowsNormalized.map((row) => row.scopeUserId);
    if (setterScopeIds.length > 0) {
      await tx.inboxCounts.deleteMany({
        where: {
          clientId: normalizedClientId,
          isGlobal: false,
          scopeUserId: { notIn: setterScopeIds },
        },
      });
    } else {
      await tx.inboxCounts.deleteMany({
        where: {
          clientId: normalizedClientId,
          isGlobal: false,
        },
      });
    }

    await tx.inboxCountsDirty.deleteMany({
      where: { clientId: normalizedClientId },
    });
  });

  await redisIncr(`inbox:v1:ver:${normalizedClientId}`);
}
