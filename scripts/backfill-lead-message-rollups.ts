/**
 * Backfill Lead message rollup fields used by the inbox filters:
 * - Lead.lastInboundAt
 * - Lead.lastOutboundAt
 * - Lead.lastZrgOutboundAt
 * - Lead.lastMessageAt
 * - Lead.lastMessageDirection
 *
 * Run with:
 * - node --import tsx scripts/backfill-lead-message-rollups.ts
 * - node --import tsx scripts/backfill-lead-message-rollups.ts --clientId <workspaceId>
 * - (alt) npx tsx scripts/backfill-lead-message-rollups.ts
 * - (alt) npx tsx scripts/backfill-lead-message-rollups.ts --clientId <workspaceId>
 *
 * Notes:
 * - Safe to re-run (idempotent).
 * - Uses aggregate SQL updates (fast, pgbouncer-friendly).
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const connectionSource = process.env.DIRECT_URL ? "DIRECT_URL" : "DATABASE_URL";
if (!connectionString) {
  throw new Error("DIRECT_URL or DATABASE_URL is required");
}

console.log(`[Rollups] Using ${connectionSource} for backfill connection`);

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
  const clientFilterSql =
    clientId && typeof clientId === "string"
      ? `JOIN "Lead" l ON l.id = m."leadId" WHERE l."clientId" = '${clientId.replace(/'/g, "''")}'`
      : "";

  console.log(`[Rollups] Backfill starting${clientId ? ` for clientId=${clientId}` : ""}...`);

  const inboundCte = clientFilterSql
    ? `FROM "Message" m ${clientFilterSql} AND m.direction = 'inbound'`
    : `FROM "Message" m WHERE m.direction = 'inbound'`;

  const outboundCte = clientFilterSql
    ? `FROM "Message" m ${clientFilterSql} AND m.direction = 'outbound'`
    : `FROM "Message" m WHERE m.direction = 'outbound'`;

  const zrgOutboundCte = clientFilterSql
    ? `FROM "Message" m ${clientFilterSql} AND m.direction = 'outbound' AND m.source = 'zrg'`
    : `FROM "Message" m WHERE m.direction = 'outbound' AND m.source = 'zrg'`;

  const lastMessageFrom = clientFilterSql
    ? `FROM "Message" m ${clientFilterSql}`
    : `FROM "Message" m`;

  const updatedInbound = await prisma.$executeRawUnsafe(`
WITH inbound AS (
  SELECT m."leadId" AS "leadId", MAX(m."sentAt") AS "sentAt"
  ${inboundCte}
  GROUP BY m."leadId"
)
UPDATE "Lead" l
SET "lastInboundAt" = inbound."sentAt"
FROM inbound
WHERE l.id = inbound."leadId";
`);

  console.log(`[Rollups] lastInboundAt updated rows: ${updatedInbound}`);

  const updatedOutbound = await prisma.$executeRawUnsafe(`
WITH outbound AS (
  SELECT m."leadId" AS "leadId", MAX(m."sentAt") AS "sentAt"
  ${outboundCte}
  GROUP BY m."leadId"
)
UPDATE "Lead" l
SET "lastOutboundAt" = outbound."sentAt"
FROM outbound
WHERE l.id = outbound."leadId";
`);

  console.log(`[Rollups] lastOutboundAt updated rows: ${updatedOutbound}`);

  const updatedZrgOutbound = await prisma.$executeRawUnsafe(`
WITH outbound AS (
  SELECT m."leadId" AS "leadId", MAX(m."sentAt") AS "sentAt"
  ${zrgOutboundCte}
  GROUP BY m."leadId"
)
UPDATE "Lead" l
SET "lastZrgOutboundAt" = outbound."sentAt"
FROM outbound
WHERE l.id = outbound."leadId";
`);

  console.log(`[Rollups] lastZrgOutboundAt updated rows: ${updatedZrgOutbound}`);

  const updatedLastMessage = await prisma.$executeRawUnsafe(`
WITH last_message AS (
  SELECT DISTINCT ON (m."leadId")
    m."leadId" AS "leadId",
    m."sentAt" AS "sentAt",
    m.direction AS direction
  ${lastMessageFrom}
  ORDER BY m."leadId", m."sentAt" DESC
)
UPDATE "Lead" l
SET
  "lastMessageAt" = last_message."sentAt",
  "lastMessageDirection" = last_message.direction
FROM last_message
WHERE l.id = last_message."leadId";
`);

  console.log(`[Rollups] lastMessageAt/lastMessageDirection updated rows: ${updatedLastMessage}`);

  console.log("[Rollups] Done.");
}

main()
  .catch((err) => {
    console.error("[Rollups] Fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
