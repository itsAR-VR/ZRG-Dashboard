/**
 * Backfill Lead message rollup fields used by the inbox filters:
 * - Lead.lastInboundAt
 * - Lead.lastOutboundAt
 * - Lead.lastMessageAt
 * - Lead.lastMessageDirection
 *
 * Run with:
 * - npx tsx scripts/backfill-lead-message-rollups.ts
 * - npx tsx scripts/backfill-lead-message-rollups.ts --clientId <workspaceId>
 *
 * Notes:
 * - Safe to re-run (idempotent).
 * - Uses Message max(sentAt) by direction to infer lastMessageDirection.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

function parseArgs(argv: string[]) {
  const args = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, true);
    } else {
      args.set(key, next);
      i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const clientId = args.get("clientId");
  const concurrency = Number(args.get("concurrency") || 25);

  const messageWhereBase: any = clientId && typeof clientId === "string" ? { lead: { clientId } } : {};

  console.log(`[Rollups] Backfill starting${clientId ? ` for clientId=${clientId}` : ""}...`);

  const [inbound, outbound] = await Promise.all([
    prisma.message.groupBy({
      by: ["leadId"],
      where: { ...messageWhereBase, direction: "inbound" },
      _max: { sentAt: true },
    }),
    prisma.message.groupBy({
      by: ["leadId"],
      where: { ...messageWhereBase, direction: "outbound" },
      _max: { sentAt: true },
    }),
  ]);

  const rollups = new Map<
    string,
    { lastInboundAt: Date | null; lastOutboundAt: Date | null; lastMessageAt: Date | null; lastMessageDirection: string | null }
  >();

  for (const row of inbound) {
    rollups.set(row.leadId, {
      lastInboundAt: row._max.sentAt ?? null,
      lastOutboundAt: null,
      lastMessageAt: row._max.sentAt ?? null,
      lastMessageDirection: row._max.sentAt ? "inbound" : null,
    });
  }

  for (const row of outbound) {
    const existing = rollups.get(row.leadId);
    const outboundAt = row._max.sentAt ?? null;
    if (!existing) {
      rollups.set(row.leadId, {
        lastInboundAt: null,
        lastOutboundAt: outboundAt,
        lastMessageAt: outboundAt,
        lastMessageDirection: outboundAt ? "outbound" : null,
      });
      continue;
    }

    existing.lastOutboundAt = outboundAt;
    const inboundAt = existing.lastInboundAt;
    if (!inboundAt && outboundAt) {
      existing.lastMessageAt = outboundAt;
      existing.lastMessageDirection = "outbound";
    } else if (inboundAt && !outboundAt) {
      existing.lastMessageAt = inboundAt;
      existing.lastMessageDirection = "inbound";
    } else if (inboundAt && outboundAt) {
      if (inboundAt.getTime() >= outboundAt.getTime()) {
        existing.lastMessageAt = inboundAt;
        existing.lastMessageDirection = "inbound";
      } else {
        existing.lastMessageAt = outboundAt;
        existing.lastMessageDirection = "outbound";
      }
    }
  }

  const entries = Array.from(rollups.entries());
  console.log(`[Rollups] Updating ${entries.length} leads...`);

  let processed = 0;
  let failed = 0;

  const queue = [...entries];
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      const [leadId, data] = next;
      try {
        await prisma.lead.update({
          where: { id: leadId },
          data,
        });
      } catch (err) {
        failed++;
        console.error(`[Rollups] Failed leadId=${leadId}:`, err);
      } finally {
        processed++;
        if (processed % 500 === 0) {
          console.log(`[Rollups] Progress: ${processed}/${entries.length} (failed: ${failed})`);
        }
      }
    }
  });

  await Promise.all(workers);

  console.log(`[Rollups] Done. Updated ${processed} leads (failed: ${failed}).`);
}

main()
  .catch((err) => {
    console.error("[Rollups] Fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

