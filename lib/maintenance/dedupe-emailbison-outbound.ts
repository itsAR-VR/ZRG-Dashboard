import { Prisma, PrismaClient } from "@prisma/client";

export type EmailBisonOutboundDedupeOptions = {
  clientId?: string;
  sinceDays: number;
  windowSeconds: number;
  batchSize: number;
  maxBatches: number;
  apply: boolean;
  verbose: boolean;
  recomputeRollups: boolean;
};

export type EmailBisonOutboundDedupePair = {
  clientId: string;
  leadId: string;
  withReplyMessageId: string;
  withoutReplyMessageId: string;
  emailBisonReplyId: string;
  withSentAt: Date;
  withoutSentAt: Date;
  withCreatedAt: Date;
  withoutCreatedAt: Date;
  withAiDraftId: string | null;
  withoutAiDraftId: string | null;
  withAiDraftPartIndex: number | null;
  withoutAiDraftPartIndex: number | null;
  withSentBy: string | null;
  withoutSentBy: string | null;
  withSentByUserId: string | null;
  withoutSentByUserId: string | null;
  withRawHtml: string | null;
  withoutRawHtml: string | null;
  withRawText: string | null;
  withoutRawText: string | null;
  withSubject: string | null;
  withoutSubject: string | null;
  withCc: string[];
  withoutCc: string[];
  withBcc: string[];
  withoutBcc: string[];
  withBody: string;
  withoutBody: string;
  withBackgroundJobs: number;
  withoutBackgroundJobs: number;
};

export type EmailBisonOutboundDedupeResult = {
  apply: boolean;
  batchesRun: number;
  pairsConsidered: number;
  pairsMerged: number;
  pairsSkipped: number;
  messagesDeleted: number;
  backgroundJobsReassigned: number;
  leadsTouched: number;
  rollupsRecomputed: number;
  remainingPairsEstimate: number | null;
  samples: Array<{
    clientId: string;
    leadId: string;
    emailBisonReplyId: string;
    withReplyMessageId: string;
    withoutReplyMessageId: string;
    deltaSeconds: number;
    action: "merge_into_without" | "skip";
    reason?: string;
  }>;
};

function normalizeForMatch(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function bodyInclusionScore(a: string, b: string): number {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (!na || !nb) return 0;

  if (na === nb) return na.length;

  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (longer.includes(shorter)) return shorter.length;

  const maxPrefix = Math.min(160, na.length, nb.length);
  const aPrefix = na.slice(0, maxPrefix);
  const bPrefix = nb.slice(0, maxPrefix);
  let score = 0;
  if (aPrefix && nb.includes(aPrefix)) score = Math.max(score, aPrefix.length);
  if (bPrefix && na.includes(bPrefix)) score = Math.max(score, bPrefix.length);
  return score;
}

function deltaSeconds(a: Date, b: Date): number {
  return Math.round(Math.abs(a.getTime() - b.getTime()) / 1000);
}

function isPlausiblePair(pair: EmailBisonOutboundDedupePair, opts: EmailBisonOutboundDedupeOptions): { ok: boolean; reason?: string } {
  const dt = deltaSeconds(pair.withSentAt, pair.withoutSentAt);
  if (dt > opts.windowSeconds) return { ok: false, reason: `sentAt_delta_${dt}s_gt_${opts.windowSeconds}s` };

  // Sanity: the "sync-imported" row should have been created after the send-created row.
  // Allow slight skew (clock/concurrency), but reject clearly inverted ordering.
  const createdSkewMs = pair.withoutCreatedAt.getTime() - pair.withCreatedAt.getTime();
  if (createdSkewMs > 60_000) return { ok: false, reason: "createdAt_inverted_gt_60s" };

  const subjA = (pair.withSubject || "").trim();
  const subjB = (pair.withoutSubject || "").trim();
  const subjectOk = !subjA || !subjB || subjA === subjB;
  if (!subjectOk) return { ok: false, reason: "subject_mismatch" };

  // If the timestamps are extremely close, treat as safe even if provider body normalization differs.
  if (dt <= 10) return { ok: true };

  const score = bodyInclusionScore(pair.withBody, pair.withoutBody);
  const shorterLen = Math.min(normalizeForMatch(pair.withBody).length, normalizeForMatch(pair.withoutBody).length);

  // If bodies are very short, don't rely on body matching — require a tighter time window.
  if (shorterLen < 20 && dt > 15) return { ok: false, reason: "short_body_requires_tighter_time_window" };

  // Otherwise, require some meaningful overlap to avoid accidentally merging two distinct quick sends.
  if (shorterLen >= 20 && score < Math.min(40, shorterLen)) return { ok: false, reason: "body_low_overlap" };

  return { ok: true };
}

async function recomputeLeadMessageRollupsForLeadIds(prisma: PrismaClient, leadIds: string[]): Promise<number> {
  if (leadIds.length === 0) return 0;

  // Postgres-friendly rollup recompute for a set of leads.
  await prisma.$executeRawUnsafe(`
WITH lead_ids AS (
  SELECT unnest(ARRAY[${leadIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",")}]) AS id
),
inbound AS (
  SELECT m."leadId" AS "leadId", MAX(m."sentAt") AS "sentAt"
  FROM "Message" m
  JOIN lead_ids li ON li.id = m."leadId"
  WHERE m.direction = 'inbound'
  GROUP BY m."leadId"
),
outbound AS (
  SELECT m."leadId" AS "leadId", MAX(m."sentAt") AS "sentAt"
  FROM "Message" m
  JOIN lead_ids li ON li.id = m."leadId"
  WHERE m.direction = 'outbound'
  GROUP BY m."leadId"
),
last_message AS (
  SELECT DISTINCT ON (m."leadId")
    m."leadId" AS "leadId",
    m."sentAt" AS "sentAt",
    m.direction AS direction
  FROM "Message" m
  JOIN lead_ids li ON li.id = m."leadId"
  ORDER BY m."leadId", m."sentAt" DESC
)
UPDATE "Lead" l
SET
  "lastInboundAt" = inbound."sentAt",
  "lastOutboundAt" = outbound."sentAt",
  "lastMessageAt" = last_message."sentAt",
  "lastMessageDirection" = last_message.direction
FROM lead_ids li
LEFT JOIN inbound ON inbound."leadId" = li.id
LEFT JOIN outbound ON outbound."leadId" = li.id
LEFT JOIN last_message ON last_message."leadId" = li.id
WHERE l.id = li.id;
`);

  return leadIds.length;
}

async function fetchCandidatePairs(prisma: PrismaClient, opts: EmailBisonOutboundDedupeOptions): Promise<EmailBisonOutboundDedupePair[]> {
  return prisma.$queryRaw<EmailBisonOutboundDedupePair[]>(Prisma.sql`
    select distinct on (m_with."emailBisonReplyId")
      l."clientId" as "clientId",
      l.id as "leadId",
      m_with.id as "withReplyMessageId",
      m_without.id as "withoutReplyMessageId",
      m_with."emailBisonReplyId" as "emailBisonReplyId",
      m_with."sentAt" as "withSentAt",
      m_without."sentAt" as "withoutSentAt",
      m_with."createdAt" as "withCreatedAt",
      m_without."createdAt" as "withoutCreatedAt",
      m_with."aiDraftId" as "withAiDraftId",
      m_without."aiDraftId" as "withoutAiDraftId",
      m_with."aiDraftPartIndex" as "withAiDraftPartIndex",
      m_without."aiDraftPartIndex" as "withoutAiDraftPartIndex",
      m_with."sentBy" as "withSentBy",
      m_without."sentBy" as "withoutSentBy",
      m_with."sentByUserId" as "withSentByUserId",
      m_without."sentByUserId" as "withoutSentByUserId",
      m_with."rawHtml" as "withRawHtml",
      m_without."rawHtml" as "withoutRawHtml",
      m_with."rawText" as "withRawText",
      m_without."rawText" as "withoutRawText",
      m_with.subject as "withSubject",
      m_without.subject as "withoutSubject",
      m_with.cc as "withCc",
      m_without.cc as "withoutCc",
      m_with.bcc as "withBcc",
      m_without.bcc as "withoutBcc",
      m_with.body as "withBody",
      m_without.body as "withoutBody",
      (select count(*) from "BackgroundJob" bj where bj."messageId" = m_with.id) as "withBackgroundJobs",
      (select count(*) from "BackgroundJob" bj where bj."messageId" = m_without.id) as "withoutBackgroundJobs"
    from "Message" m_with
    join "Message" m_without on m_without."leadId" = m_with."leadId"
    join "Lead" l on l.id = m_with."leadId"
    where ${opts.clientId ? Prisma.sql`l."clientId" = ${opts.clientId} and` : Prisma.empty}
      m_with.channel = 'email'
      and m_with.direction = 'outbound'
      and m_with.source = 'zrg'
      and m_with."emailBisonReplyId" is not null
      and m_with."emailBisonReplyId" not like 'smartlead:%'
      and m_with."emailBisonReplyId" not like 'instantly:%'
      and m_with."sentAt" >= now() - (cast(${opts.sinceDays} as int) * interval '1 day')
      and m_without.channel = 'email'
      and m_without.direction = 'outbound'
      and m_without.source = 'zrg'
      and m_without."emailBisonReplyId" is null
      and abs(extract(epoch from (m_with."sentAt" - m_without."sentAt"))) <= cast(${opts.windowSeconds} as int)
      and (m_with.subject is null or m_without.subject is null or m_with.subject = m_without.subject)
    order by m_with."emailBisonReplyId",
      abs(extract(epoch from (m_with."sentAt" - m_without."sentAt"))) asc
    limit ${opts.batchSize};
  `);
}

async function estimateRemainingPairs(prisma: PrismaClient, opts: EmailBisonOutboundDedupeOptions): Promise<number | null> {
  // Fast-ish "is there more?" probe. We avoid COUNT(*) because it's often slow on large tables.
  const probe = await prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
    select 1 as n
    from "Message" m_with
    join "Message" m_without on m_without."leadId" = m_with."leadId"
    join "Lead" l on l.id = m_with."leadId"
    where ${opts.clientId ? Prisma.sql`l."clientId" = ${opts.clientId} and` : Prisma.empty}
      m_with.channel = 'email'
      and m_with.direction = 'outbound'
      and m_with.source = 'zrg'
      and m_with."emailBisonReplyId" is not null
      and m_with."emailBisonReplyId" not like 'smartlead:%'
      and m_with."emailBisonReplyId" not like 'instantly:%'
      and m_with."sentAt" >= now() - (cast(${opts.sinceDays} as int) * interval '1 day')
      and m_without.channel = 'email'
      and m_without.direction = 'outbound'
      and m_without.source = 'zrg'
      and m_without."emailBisonReplyId" is null
      and abs(extract(epoch from (m_with."sentAt" - m_without."sentAt"))) <= cast(${opts.windowSeconds} as int)
      and (m_with.subject is null or m_without.subject is null or m_with.subject = m_without.subject)
    limit 1;
  `);

  if (probe.length === 0) return 0;
  return null; // unknown (but non-zero)
}

export async function dedupeEmailBisonOutboundMessages(
  prisma: PrismaClient,
  opts: EmailBisonOutboundDedupeOptions
): Promise<EmailBisonOutboundDedupeResult> {
  const samples: EmailBisonOutboundDedupeResult["samples"] = [];
  const touchedLeadIds = new Set<string>();
  const usedMessageIds = new Set<string>();

  let batchesRun = 0;
  let pairsConsidered = 0;
  let pairsMerged = 0;
  let pairsSkipped = 0;
  let messagesDeleted = 0;
  let backgroundJobsReassigned = 0;

  // Dry-run: show a single batch preview; applying requires repeated batches.
  const maxBatches = opts.apply ? Math.max(1, opts.maxBatches) : 1;

  for (let batchIndex = 0; batchIndex < maxBatches; batchIndex++) {
    const pairs = await fetchCandidatePairs(prisma, opts);
    if (pairs.length === 0) break;

    batchesRun++;
    let mergedThisBatch = 0;

    for (const pair of pairs) {
      if (usedMessageIds.has(pair.withReplyMessageId) || usedMessageIds.has(pair.withoutReplyMessageId)) {
        pairsSkipped++;
        const dt = deltaSeconds(pair.withSentAt, pair.withoutSentAt);
        if (opts.verbose || samples.length < 25) {
          samples.push({
            clientId: pair.clientId,
            leadId: pair.leadId,
            emailBisonReplyId: pair.emailBisonReplyId,
            withReplyMessageId: pair.withReplyMessageId,
            withoutReplyMessageId: pair.withoutReplyMessageId,
            deltaSeconds: dt,
            action: "skip",
            reason: "overlapping_pair",
          });
        }
        continue;
      }

      usedMessageIds.add(pair.withReplyMessageId);
      usedMessageIds.add(pair.withoutReplyMessageId);

      pairsConsidered++;
      const dt = deltaSeconds(pair.withSentAt, pair.withoutSentAt);
      const plausible = isPlausiblePair(pair, opts);

      if (!plausible.ok) {
        pairsSkipped++;
        if (opts.verbose || samples.length < 25) {
          samples.push({
            clientId: pair.clientId,
            leadId: pair.leadId,
            emailBisonReplyId: pair.emailBisonReplyId,
            withReplyMessageId: pair.withReplyMessageId,
            withoutReplyMessageId: pair.withoutReplyMessageId,
            deltaSeconds: dt,
            action: "skip",
            reason: plausible.reason,
          });
        }
        continue;
      }

      if (!opts.apply) {
        pairsMerged++;
        messagesDeleted++;
        mergedThisBatch++;
        if (opts.verbose || samples.length < 25) {
          samples.push({
            clientId: pair.clientId,
            leadId: pair.leadId,
            emailBisonReplyId: pair.emailBisonReplyId,
            withReplyMessageId: pair.withReplyMessageId,
            withoutReplyMessageId: pair.withoutReplyMessageId,
            deltaSeconds: dt,
            action: "merge_into_without",
          });
        }
        continue;
      }

      const keepId = pair.withoutReplyMessageId;
      const deleteId = pair.withReplyMessageId;

      const updateData: Prisma.MessageUncheckedUpdateInput = {
        emailBisonReplyId: pair.emailBisonReplyId,
        isRead: true,
        // Prefer provider timestamp for canonical ordering.
        sentAt: pair.withSentAt,
      };

      if (!pair.withoutRawHtml && pair.withRawHtml) updateData.rawHtml = pair.withRawHtml;
      if (!pair.withoutRawText && pair.withRawText) updateData.rawText = pair.withRawText;
      if (!pair.withoutSubject && pair.withSubject) updateData.subject = pair.withSubject;
      if ((!pair.withoutCc || pair.withoutCc.length === 0) && pair.withCc?.length) updateData.cc = pair.withCc;
      if ((!pair.withoutBcc || pair.withoutBcc.length === 0) && pair.withBcc?.length) updateData.bcc = pair.withBcc;

      // Preserve attribution/draft metadata if it only exists on the sync-imported row (rare).
      if (!pair.withoutAiDraftId && pair.withAiDraftId) {
        updateData.aiDraftId = pair.withAiDraftId;
        if (pair.withAiDraftPartIndex != null) updateData.aiDraftPartIndex = pair.withAiDraftPartIndex;
      }
      if (!pair.withoutSentBy && pair.withSentBy) updateData.sentBy = pair.withSentBy;
      if (!pair.withoutSentByUserId && pair.withSentByUserId) updateData.sentByUserId = pair.withSentByUserId;

      await prisma.$transaction(async (tx) => {
        // Preserve background job history by re-pointing to the kept message.
        const moved = await tx.backgroundJob.updateMany({
          where: { messageId: deleteId },
          data: { messageId: keepId },
        });
        backgroundJobsReassigned += moved.count;

        // Delete the row that currently owns emailBisonReplyId first to avoid unique-constraint violations.
        await tx.message.delete({ where: { id: deleteId } });
        await tx.message.update({ where: { id: keepId }, data: updateData });
      });

      pairsMerged++;
      mergedThisBatch++;
      messagesDeleted++;
      touchedLeadIds.add(pair.leadId);

      if (opts.verbose || samples.length < 25) {
        samples.push({
          clientId: pair.clientId,
          leadId: pair.leadId,
          emailBisonReplyId: pair.emailBisonReplyId,
          withReplyMessageId: pair.withReplyMessageId,
          withoutReplyMessageId: pair.withoutReplyMessageId,
          deltaSeconds: dt,
          action: "merge_into_without",
        });
      }
    }

    // If we made no progress in apply mode, we're likely stuck on ambiguous overlaps; stop early.
    if (opts.apply && mergedThisBatch === 0) break;
  }

  let rollupsRecomputed = 0;
  if (opts.apply && opts.recomputeRollups && touchedLeadIds.size > 0) {
    rollupsRecomputed = await recomputeLeadMessageRollupsForLeadIds(prisma, Array.from(touchedLeadIds));
  }

  const remainingPairsEstimate = await estimateRemainingPairs(prisma, opts);

  return {
    apply: opts.apply,
    batchesRun,
    pairsConsidered,
    pairsMerged,
    pairsSkipped,
    messagesDeleted,
    backgroundJobsReassigned,
    leadsTouched: touchedLeadIds.size,
    rollupsRecomputed,
    remainingPairsEstimate,
    samples,
  };
}
