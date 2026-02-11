/**
 * Backfill Memory Allowlist Defaults (Phase 127 follow-up)
 *
 * After Phase 127, an empty memory allowlist is treated as fail-closed:
 * no inferred memory entries are auto-approved; everything becomes PENDING
 * for Super Admin review.
 *
 * This script backfills DEFAULT_MEMORY_POLICY.allowlistCategories for any
 * WorkspaceSettings rows that currently have an empty allowlist, so existing
 * workspaces keep the "sane defaults" behavior without hiding the meaning of
 * an intentionally empty allowlist going forward.
 *
 * Run:
 *   node --require ./scripts/server-only-mock.cjs --import tsx scripts/backfill-memory-allowlist-defaults.ts --dry-run
 *   node --require ./scripts/server-only-mock.cjs --import tsx scripts/backfill-memory-allowlist-defaults.ts --apply
 *   node --require ./scripts/server-only-mock.cjs --import tsx scripts/backfill-memory-allowlist-defaults.ts --apply --limit 500
 *
 * Env:
 *   DATABASE_URL   Required
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import dns from "node:dns";

import { DEFAULT_MEMORY_POLICY } from "../lib/memory-governance/types";

dns.setDefaultResultOrder("ipv4first");

type Args = {
  dryRun: boolean;
  limit: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: true, limit: 500 };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry-run" || a === "--dryRun") args.dryRun = true;
    else if (a === "--apply") args.dryRun = false;
    else if (a === "--limit") args.limit = Number(argv[i + 1] || "0") || args.limit;
    if (a === "--limit") i += 1;
  }
  args.limit = Math.max(1, Math.trunc(args.limit));
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL environment variable is required");

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  console.log("=".repeat(80));
  console.log("Backfill Memory Allowlist Defaults");
  console.log("=".repeat(80));
  console.log(`Started: ${new Date().toISOString()}`);
  console.log(`Mode:    ${args.dryRun ? "DRY RUN (no writes)" : "APPLY"}`);
  console.log(`Limit:   ${args.limit}`);
  console.log(`Defaults: ${DEFAULT_MEMORY_POLICY.allowlistCategories.join(", ")}`);
  console.log("=".repeat(80));

  let scanned = 0;
  let updated = 0;

  for (;;) {
    const rows = await prisma.workspaceSettings.findMany({
      where: { memoryAllowlistCategories: { isEmpty: true } },
      take: args.limit,
      orderBy: { clientId: "asc" },
      select: { clientId: true },
    });

    if (rows.length === 0) break;
    scanned += rows.length;

    const clientIds = rows.map((r) => r.clientId);
    console.log(`[Batch] Found ${rows.length} workspace(s) with empty allowlist`);

    if (args.dryRun) {
      console.log(`[DRY RUN] Would backfill: ${clientIds.slice(0, 25).join(", ")}${clientIds.length > 25 ? ", ..." : ""}`);
      break;
    }

    const res = await prisma.workspaceSettings.updateMany({
      where: { clientId: { in: clientIds }, memoryAllowlistCategories: { isEmpty: true } },
      data: { memoryAllowlistCategories: DEFAULT_MEMORY_POLICY.allowlistCategories },
    });
    updated += typeof res?.count === "number" ? res.count : 0;

    if (rows.length < args.limit) break;
  }

  console.log("");
  console.log(`[Done] scanned=${scanned} updated=${args.dryRun ? 0 : updated}`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[Backfill] Failed:", error);
  process.exit(1);
});

