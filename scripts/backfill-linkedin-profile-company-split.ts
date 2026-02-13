/**
 * Phase 151 LinkedIn backfill:
 * Moves legacy company URLs out of Lead.linkedinUrl into Lead.linkedinCompanyUrl.
 *
 * Dry-run (default):
 *   node --import tsx scripts/backfill-linkedin-profile-company-split.ts
 *
 * Tim canary apply:
 *   node --import tsx scripts/backfill-linkedin-profile-company-split.ts --apply --clientId 779e97c3-e7bd-4c1a-9c46-fe54310ae71f
 *
 * Global apply:
 *   node --import tsx scripts/backfill-linkedin-profile-company-split.ts --apply
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

type Args = {
  apply: boolean;
  clientId: string | null;
};

function parseArgs(argv: string[]): Args {
  let apply = false;
  let clientId: string | null = null;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") apply = true;
    if (arg === "--dry-run") apply = false;
    if (arg === "--clientId") clientId = argv[i + 1] ?? null;
    if (arg === "--clientId") i += 1;
  }

  return { apply, clientId };
}

function companyUrlWhereClause(clientId: string | null): Prisma.Sql {
  if (clientId) {
    return Prisma.sql`WHERE "linkedinUrl" ILIKE '%linkedin.com/company/%' AND "clientId" = ${clientId}`;
  }
  return Prisma.sql`WHERE "linkedinUrl" ILIKE '%linkedin.com/company/%'`;
}

async function main() {
  const args = parseArgs(process.argv);
  const connectionString = process.env.DATABASE_URL || process.env.DIRECT_URL;
  if (!connectionString) {
    throw new Error("[Phase151 LinkedIn Backfill] DATABASE_URL or DIRECT_URL must be set");
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  const where = companyUrlWhereClause(args.clientId);

  const [totalRow] = await prisma.$queryRaw<Array<{ count: number }>>(
    Prisma.sql`
      SELECT count(*)::int AS count
      FROM "Lead"
      ${where}
    `
  );
  const total = Number(totalRow?.count ?? 0);

  console.log(
    `[Phase151 LinkedIn Backfill] mode=${args.apply ? "APPLY" : "DRY_RUN"} clientId=${args.clientId ?? "ALL"} candidates=${total}`
  );

  if (!args.apply || total === 0) {
    await prisma.$disconnect();
    return;
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_phase151_linkedin_backfill_backup" (
      "leadId" text PRIMARY KEY,
      "clientId" text NOT NULL,
      "oldLinkedinUrl" text NOT NULL,
      "oldLinkedinCompanyUrl" text NULL,
      "backfilledAt" timestamptz NOT NULL DEFAULT now()
    );
  `);

  const backupInserted = await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "_phase151_linkedin_backfill_backup" ("leadId", "clientId", "oldLinkedinUrl", "oldLinkedinCompanyUrl", "backfilledAt")
      SELECT "id", "clientId", "linkedinUrl", "linkedinCompanyUrl", now()
      FROM "Lead"
      ${where}
      ON CONFLICT ("leadId") DO NOTHING
    `
  );

  const updated = await prisma.$executeRaw(
    Prisma.sql`
      UPDATE "Lead"
      SET
        "linkedinCompanyUrl" = COALESCE("linkedinCompanyUrl", "linkedinUrl"),
        "linkedinUrl" = NULL,
        "updatedAt" = now()
      ${where}
    `
  );

  const [remainingRow] = await prisma.$queryRaw<Array<{ count: number }>>(
    Prisma.sql`
      SELECT count(*)::int AS count
      FROM "Lead"
      ${where}
    `
  );
  const remaining = Number(remainingRow?.count ?? 0);

  console.log(
    `[Phase151 LinkedIn Backfill] backupInserted=${backupInserted} updated=${updated} remainingCompanyUrlsInLinkedinUrl=${remaining}`
  );
  console.log(
    `[Phase151 LinkedIn Backfill] Keep _phase151_linkedin_backfill_backup for 7 days, then drop if no rollback is required.`
  );

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[Phase151 LinkedIn Backfill] failed:", error);
  process.exitCode = 1;
});
