/**
 * Founders Club (FC) duplicate outbound EmailBison reply detector/merger.
 *
 * This targets the historical pattern created by the EmailBison send ↔ sync loop:
 * - One outbound Message row created at send time (emailBisonReplyId = NULL)
 * - One outbound Message row imported by sync (emailBisonReplyId != NULL)
 *
 * Output is IDs only (no message bodies/emails).
 *
 * Run (dry-run, default):
 *   npx tsx scripts/dedupe-fc-emailbison-outbound.ts
 *
 * Run (apply merge/delete):
 *   npx tsx scripts/dedupe-fc-emailbison-outbound.ts --apply
 *
 * Options:
 *   --client-id <uuid>       (default: FC clientId)
 *   --since-days <n>         (default: 60)
 *   --window-seconds <n>     (default: 120)
 *   --limit <n>              (default: 2000)
 *   --verbose                (print per-pair line items)
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const DEFAULT_FC_CLIENT_ID = "ef824aca-a3c9-4cde-b51f-2e421ebb6b6e";

type CliOptions = {
  clientId: string;
  sinceDays: number;
  windowSeconds: number;
  limit: number;
  apply: boolean;
  verbose: boolean;
};

function parseFlagValue(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const next = args[index + 1];
  return typeof next === "string" && !next.startsWith("--") ? next : null;
}

function parseIntOr(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptions(): CliOptions {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const verbose = args.includes("--verbose");

  const clientId = parseFlagValue(args, "--client-id") || DEFAULT_FC_CLIENT_ID;
  const sinceDays = parseIntOr(parseFlagValue(args, "--since-days"), 60);
  const windowSeconds = parseIntOr(parseFlagValue(args, "--window-seconds"), 120);
  const limit = parseIntOr(parseFlagValue(args, "--limit"), 2000);

  return {
    clientId,
    sinceDays: Math.max(1, sinceDays),
    windowSeconds: Math.max(1, windowSeconds),
    limit: Math.max(1, limit),
    apply,
    verbose,
  };
}

type CandidatePair = {
  leadId: string;
  withReplyMessageId: string;
  withoutReplyMessageId: string;
  emailBisonReplyId: string;
  withSentAt: Date;
  withoutSentAt: Date;
  withAiDraftId: string | null;
  withoutAiDraftId: string | null;
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
};

function shouldPreferWithout(pair: CandidatePair): boolean {
  return Boolean(pair.withoutAiDraftId) || Boolean(pair.withoutSentByUserId) || pair.withoutSentBy === "setter";
}

function formatDeltaSeconds(a: Date, b: Date): number {
  return Math.round(Math.abs(a.getTime() - b.getTime()) / 1000);
}

async function main() {
  const opts = parseOptions();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("[fc-email-dedupe] DATABASE_URL is required");
    process.exit(1);
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    const pairs = await prisma.$queryRaw<CandidatePair[]>(Prisma.sql`
      select distinct on (m_with."emailBisonReplyId")
        l.id as "leadId",
        m_with.id as "withReplyMessageId",
        m_without.id as "withoutReplyMessageId",
        m_with."emailBisonReplyId" as "emailBisonReplyId",
        m_with."sentAt" as "withSentAt",
        m_without."sentAt" as "withoutSentAt",
        m_with."aiDraftId" as "withAiDraftId",
        m_without."aiDraftId" as "withoutAiDraftId",
        m_with."sentBy" as "withSentBy",
        m_without."sentBy" as "withoutSentBy",
        m_with."sentByUserId" as "withSentByUserId",
        m_without."sentByUserId" as "withoutSentByUserId",
        m_with."rawHtml" as "withRawHtml",
        m_without."rawHtml" as "withoutRawHtml",
        m_with."rawText" as "withRawText",
        m_without."rawText" as "withoutRawText",
        m_with.subject as "withSubject",
        m_without.subject as "withoutSubject"
      from "Message" m_with
      join "Message" m_without on m_without."leadId" = m_with."leadId"
      join "Lead" l on l.id = m_with."leadId"
      where l."clientId" = ${opts.clientId}
        and m_with.channel = 'email'
        and m_with.direction = 'outbound'
        and m_with.source = 'zrg'
        and m_with."emailBisonReplyId" is not null
        and m_with."sentAt" >= now() - (cast(${opts.sinceDays} as int) * interval '1 day')
        and m_without.channel = 'email'
        and m_without.direction = 'outbound'
        and m_without.source = 'zrg'
        and m_without."emailBisonReplyId" is null
        and abs(extract(epoch from (m_with."sentAt" - m_without."sentAt"))) <= cast(${opts.windowSeconds} as int)
        and (m_with.subject is null or m_without.subject is null or m_with.subject = m_without.subject)
      order by m_with."emailBisonReplyId",
        abs(extract(epoch from (m_with."sentAt" - m_without."sentAt"))) asc
      limit ${opts.limit};
    `);

    const plannedMerges = pairs.filter((p) => shouldPreferWithout(p)).length;
    const plannedDeletes = pairs.length - plannedMerges;

    console.log(
      `[fc-email-dedupe] pairs=${pairs.length} merges=${plannedMerges} deletes=${plannedDeletes} ` +
        `(clientId=${opts.clientId}, sinceDays=${opts.sinceDays}, windowSeconds=${opts.windowSeconds}, limit=${opts.limit}, apply=${opts.apply})`
    );

    if (opts.verbose) {
      for (const pair of pairs) {
        const deltaSeconds = formatDeltaSeconds(pair.withSentAt, pair.withoutSentAt);
        const action = shouldPreferWithout(pair) ? "merge_into_without" : "delete_without";
        console.log(
          `[fc-email-dedupe] leadId=${pair.leadId} replyId=${pair.emailBisonReplyId} ` +
            `with=${pair.withReplyMessageId} without=${pair.withoutReplyMessageId} Δ=${deltaSeconds}s action=${action}`
        );
      }
    }

    if (!opts.apply) {
      console.log("[fc-email-dedupe] dry-run complete (no changes applied)");
      return;
    }

    let merged = 0;
    let deleted = 0;
    let skipped = 0;

    const usedMessageIds = new Set<string>();

    for (const pair of pairs) {
      if (usedMessageIds.has(pair.withReplyMessageId) || usedMessageIds.has(pair.withoutReplyMessageId)) {
        skipped++;
        continue;
      }

      usedMessageIds.add(pair.withReplyMessageId);
      usedMessageIds.add(pair.withoutReplyMessageId);

      const preferWithout = shouldPreferWithout(pair);

      if (preferWithout) {
        const replyId = pair.emailBisonReplyId;
        const rawHtml = pair.withRawHtml;
        const rawText = pair.withRawText;
        const subject = pair.withSubject;

        await prisma.$transaction(async (tx) => {
          await tx.message.delete({ where: { id: pair.withReplyMessageId } });
          const updateData: Prisma.MessageUpdateInput = {
            emailBisonReplyId: replyId,
            isRead: true,
          };

          if (!pair.withoutRawHtml && rawHtml) updateData.rawHtml = rawHtml;
          if (!pair.withoutRawText && rawText) updateData.rawText = rawText;
          if (!pair.withoutSubject && subject) updateData.subject = subject;

          await tx.message.update({ where: { id: pair.withoutReplyMessageId }, data: updateData });
        });

        merged++;
      } else {
        await prisma.message.delete({ where: { id: pair.withoutReplyMessageId } });
        deleted++;
      }
    }

    console.log(`[fc-email-dedupe] applied merges=${merged} deletes=${deleted} skipped=${skipped}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[fc-email-dedupe] failed:", error);
  process.exit(1);
});
